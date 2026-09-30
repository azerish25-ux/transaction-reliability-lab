"""Real HTTP/SQL experiments; the same D02 oracle runs in all three phases."""
from __future__ import annotations

import json
import os
import random
import threading
import time
from typing import Any, Callable

from clients import ALTERNATE, Api, DESTINATION, Oracle, SOURCE
from core import (LabError, Settings, Store, canonical, classify_defect, digest,
                  require, run_case, timestamp)


class Runner:
    def __init__(self, settings: Settings, store: Store):
        self.settings, self.store = settings, store
        self.oracle = Oracle(settings)
        self.fixture_session = None
        self.checkpoint_ms = int(os.environ.get('LEDGER_LAB_TEST_CHECKPOINT_MS', '0'))
        if not 0 <= self.checkpoint_ms <= 21000:
            raise LabError('INVALID_LAB_TEST_CHECKPOINT')

    def fixture_api(self, host: str = 'control-api') -> Api:
        """Reuse an in-memory fixture session without weakening normal auth budgets.

        Every new experiment validates the session through the real protected API.
        Only an explicit 401 permits one fresh login; dependency failures fail closed.
        No cookie or CSRF material enters artifacts or persistent experiment state.
        """
        if self.fixture_session is None:
            self.fixture_session = Api('control-api')
            self.fixture_session.login('alice@example.test', os.environ['LEDGER_DEMO_PASSWORD'])
        else:
            response = self.fixture_session.call('GET', '/api/v1/auth/me')
            if response.status == 401:
                self.fixture_session = Api('control-api')
                self.fixture_session.login('alice@example.test', os.environ['LEDGER_DEMO_PASSWORD'])
            elif response.status != 200:
                raise LabError('FIXTURE_SESSION_VALIDATION_FAILED')
        api = Api(host)
        api.cookies = dict(self.fixture_session.cookies)
        api.csrf_header, api.csrf_token = self.fixture_session.csrf_header, self.fixture_session.csrf_token
        return api

    def wait(self, generation: int, mode: str, timeout: float = 15) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            lease = self.store.lease()
            if lease['generation'] != generation:
                raise LabError('FAULT_GENERATION_CHANGED', 409)
            if lease['error']:
                raise LabError('GUARDIAN_RESTORATION_ERROR', 503)
            if lease['applied_generation'] == generation and lease['applied'] == mode:
                return json.loads(lease['proof'])
            time.sleep(0.1)
        raise TimeoutError('FAULT_ACKNOWLEDGEMENT_TIMEOUT')

    def activate(self, run_id: str, mode: str) -> dict[str, Any]:
        generation = self.store.request_fault(run_id, mode)
        proof = self.wait(generation, mode)
        return {'mode': mode, 'generation': generation, 'observedAt': timestamp(), **proof}

    def restore(self, run_id: str) -> dict[str, Any]:
        generation = self.store.reset(run_id)
        return self.wait(generation, 'NONE')

    def result_identity(self, run: dict[str, Any]) -> dict[str, Any]:
        """Bind every terminal report to the same source, instance and durable run.

        Recovery must not invent executed phases or reuse a previous verdict, but
        its cancellation report still needs the identity checked by the evidence gate.
        """
        return {'schemaVersion': 1, 'sourceSha': self.settings.source,
                'dirtySource': self.settings.dirty, 'instanceId': self.settings.instance,
                'runId': run['id'], 'scenario': run['scenario'], 'seed': run['seed']}

    def execute(self, run: dict[str, Any]) -> dict[str, Any]:
        if run['scenario'] == 'D06':
            from duplicate_defect import execute_d06
            return execute_d06(self, run)
        if run['scenario'] == 'F02':
            from broker_experiment import execute_f02
            return execute_f02(self, run)
        run_id, scenario = run['id'], run['scenario']
        result: dict[str, Any] = {
            **self.result_identity(run),
            'scope': 'REAL_HTTP_POSTGRES_TOXIPROXY' if scenario == 'F01' else 'REAL_HTTP_POSTGRES',
            'startedAt': timestamp(), 'testCheckpointHoldMs': self.checkpoint_ms,
            'phases': {}, 'cleanup': {'restored': False},
            'verdict': 'INVALID_EXPERIMENT',
        }
        phases = result['phases']
        amount = str(random.Random(run['seed']).randint(20, 40))
        intent = {'sourceId': SOURCE, 'recipientRef': 'LG-' + DESTINATION.replace('-', ''),
                  'amountMinor': amount, 'currency': 'CAD'}
        changed = {**intent, 'recipientRef': 'LG-' + ALTERNATE.replace('-', '')}
        key = 'p09a:' + run_id
        inputs = {'seed': run['seed'], 'original': intent, 'changed': changed, 'key': key}
        input_hash = digest(canonical(inputs).encode())
        result['input'] = inputs  # No session, CSRF, credentials or signing material.
        api, control = Api(), Api('control-api')
        operation: str | None = None
        baseline_snapshot: str | None = None

        def original(observations: dict[str, Any]) -> None:
            nonlocal operation, baseline_snapshot
            self.store.check_run(run_id)
            response = api.call('POST', '/api/v1/transfers', intent, key)
            require(response.status == 201, 'ORIGINAL_TRANSFER_ACCEPTED', 201, response.status)
            body = response.json()
            if operation is not None:
                require(body.get('id') == operation, 'SAME_KEY_ONE_OPERATION', operation, body.get('id'))
            operation = body['id']
            observations['posting'] = self.oracle.operation(operation, amount, key)
            observations['reconciliation'] = self.oracle.snapshot()
            observed = observations['reconciliation']['sha256']
            if baseline_snapshot is None:
                baseline_snapshot = observed
            else:
                require(observed == baseline_snapshot, 'REPLAY_PRESERVES_GLOBAL_FINANCIAL_STATE', baseline_snapshot, observed)

        def d02(observations: dict[str, Any]) -> None:
            original(observations)
            replay = api.call('POST', '/api/v1/transfers', intent, key)
            require(replay.status == 201, 'EXACT_REPLAY_STATUS', 201, replay.status)
            require(replay.json().get('id') == operation, 'EXACT_REPLAY_IDENTITY', operation, replay.json().get('id'))
            before = self.oracle.snapshot()
            mismatch = api.call('POST', '/api/v1/transfers', changed, key)
            after = self.oracle.snapshot()
            observations.update(financialStateUnchanged=before['sha256'] == after['sha256'],
                                changedRecipientStatus=mismatch.status,
                                beforeSha256=before['sha256'], afterSha256=after['sha256'])
            require(observations['financialStateUnchanged'], 'REPLAY_NO_ADDITIONAL_FINANCIAL_EFFECT',
                    before['sha256'], after['sha256'])
            # This is the same contract assertion on baseline, mutant and restoration.
            # It does not inspect a fault flag or change its expected response.
            require(mismatch.status == 409, 'D02_CHANGED_RECIPIENT_REJECTED', 409, mismatch.status)
            require(mismatch.json().get('code') == 'IDEMPOTENCY_CONFLICT', 'D02_CONFLICT_CODE',
                    'IDEMPOTENCY_CONFLICT', mismatch.json().get('code'))

        def latency(observations: dict[str, Any]) -> None:
            self.store.check_run(run_id)
            start = time.monotonic()
            response = api.call('GET', '/api/v1/accounts')
            elapsed = time.monotonic() - start
            observations.update(httpStatus=response.status, elapsedSeconds=round(elapsed, 6))
            require(response.status == 200, 'F01_LATENCY_READ_SUCCEEDS', 200, response.status)
            require(elapsed >= 0.15, 'F01_LATENCY_HAS_OBSERVABLE_EFFECT', 'at least 0.15 seconds', elapsed)
            observations['reconciliation'] = self.oracle.snapshot()

        def disruption(observations: dict[str, Any]) -> None:
            self.store.check_run(run_id)
            start = time.monotonic()
            try:
                response = api.call('POST', '/api/v1/transfers', intent, key)
                status: int | str = response.status
            except TimeoutError:
                status = 'BOUNDED_TIMEOUT'
            observations.update(httpStatus=status, elapsedSeconds=round(time.monotonic() - start, 6))
            require(status in {503, 'BOUNDED_TIMEOUT'}, 'F01_DISRUPTION_CONTROLLED_OUTCOME',
                    [503, 'BOUNDED_TIMEOUT'], status)
            control_response = control.call('GET', '/api/v1/auth/me')
            require(control_response.status == 200, 'F01_CONTROL_PLANE_REMAINS_AVAILABLE', 200,
                    control_response.status)
            observations['controlStatus'] = control_response.status
            observations['reconciliation'] = self.oracle.snapshot()

        try:
            self.store.check_run(run_id)
            control = self.fixture_api()
            api.cookies = dict(control.cookies)
            api.csrf_header, api.csrf_token = control.csrf_header, control.csrf_token
            case: Callable[[dict[str, Any]], None] = d02 if scenario == 'D02' else original
            test_id = 'D02_PAYLOAD_CONFLICT' if scenario == 'D02' else 'F01_DATABASE_RECOVERY'
            phases['baseline'] = run_case(test_id, case, input_hash)
            if phases['baseline']['status'] != 'PASS':
                result['verdict'] = 'BASELINE_FAILED'
            elif scenario == 'D02':
                result['activation'] = self.activate(run_id, 'D02')
                # Lab-only, externally configured bounded checkpoint for real crash/expiry tests.
                # Never present in normal artifacts or accepted as a qualified D02 detection.
                if self.checkpoint_ms:
                    time.sleep(self.checkpoint_ms / 1000)
                phases['mutant'] = run_case(test_id, case, input_hash)
            else:
                result['routeProof'] = self.oracle.route_proof()
                result['activation'] = {'latency': self.activate(run_id, 'F01_LATENCY')}
                phases['latency'] = run_case(test_id, latency, input_hash)
                self.restore(run_id)
                if phases['latency']['status'] == 'PASS':
                    result['activation']['disruption'] = self.activate(run_id, 'F01_DISCONNECT')
                    phases['disruption'] = run_case(test_id, disruption, input_hash)
        except Exception as error:
            result['executionError'] = {'type': type(error).__name__}
            if isinstance(error, LabError):
                result['executionError']['code'] = error.code
        finally:
            try:
                result['cleanup'] = self.restore(run_id)
            except Exception as error:
                result['cleanup'] = {'restored': False, 'errorType': type(error).__name__}
            if result['cleanup'].get('restored') and phases.get('baseline', {}).get('status') == 'PASS':
                phases['restored'] = run_case('D02_PAYLOAD_CONFLICT' if scenario == 'D02'
                                               else 'F01_DATABASE_RECOVERY',
                                               d02 if scenario == 'D02' else original, input_hash)
            if scenario == 'D02':
                result['verdict'] = classify_defect(phases, result['cleanup'])
            elif not result['cleanup'].get('restored'):
                result['verdict'] = 'CLEANUP_FAILED'
            elif phases.get('baseline', {}).get('status') != 'PASS':
                result['verdict'] = 'BASELINE_FAILED'
            else:
                result['verdict'] = ('PASSED' if set(phases) == {'baseline', 'latency', 'disruption', 'restored'}
                                     and all(p['status'] == 'PASS' for p in phases.values()) else 'FAILED')
            if self.store.get(run_id)['cancelled']:
                result['verdict'] = 'CANCELLED' if result['cleanup'].get('restored') else 'CLEANUP_FAILED'
            result['finishedAt'] = timestamp()
            self.store.finish(run_id, result)
        return result

    def recover(self) -> None:
        self.store.recover_interrupted()
        # Restoration acknowledgement precedes accepting another experiment.
        generation = self.store.lease()['generation']
        try:
            cleanup = self.wait(generation, 'NONE', 20)
        except Exception:
            cleanup = {'restored': False}
        for run in self.store.recent():
            if run['status'] in {'QUEUED', 'RUNNING', 'CLEANING'}:
                result = {**self.result_identity(run), 'phases': {}, 'cleanup': cleanup,
                          'verdict': 'CANCELLED' if cleanup.get('restored') else 'CLEANUP_FAILED',
                          'reason': 'CONTROLLER_RESTART_INTERRUPTED_EXPERIMENT', 'finishedAt': timestamp()}
                self.store.finish(run['id'], result)

    def loop(self, stop: threading.Event) -> None:
        self.recover()
        while not stop.is_set():
            self.store.heartbeat('worker')
            run = self.store.claim()
            if run:
                self.execute(run)
            else:
                stop.wait(0.25)
