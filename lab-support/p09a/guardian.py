"""Independent lab-only expiry/reset process. No listener, shell or Docker socket.

Among the two lab-control processes, only the guardian receives the disposable
database-owner credential. The existing migration/seed processes retain their
owner credential; the web controller cannot submit SQL or target URLs.
"""
from __future__ import annotations
import json
import signal
import threading
import time
from typing import Any

from clients import FUNCTION, Oracle, request
from core import FAULT_SECONDS, LabError, Settings, Store, canonical, digest
from proxy_contract import is_lab_proxy

CLAUSE = "IF prior.fingerprint<>fingerprint THEN"
MUTANT = "IF FALSE AND prior.fingerprint<>fingerprint THEN"
PROXY_PATH = '/proxies/p09a-postgres'
TOXIC_NAME = 'p09a-latency'


def mutate_definition(original: str) -> str:
    if (original.count(CLAUSE) != 1 or MUTANT in original
            or not original.startswith('CREATE OR REPLACE FUNCTION ledger.execute_command(')):
        raise LabError('D02_MUTATION_TARGET_NOT_UNIQUE', 503)
    return original.replace(CLAUSE, MUTANT, 1)


class Driver:
    def __init__(self, settings: Settings):
        self.oracle = Oracle(settings)

    @staticmethod
    def proxy(method: str = 'GET', suffix: str = '', payload: Any = None) -> Any:
        if suffix not in {'', '/toxics', '/toxics/' + TOXIC_NAME}:
            raise LabError('PROXY_PATH_NOT_ALLOWLISTED')
        response = request('toxiproxy', 8474, method, PROXY_PATH + suffix,
                           body=canonical(payload).encode() if payload is not None else None,
                           headers={'Content-Type': 'application/json'}, timeout=3)
        if response.status not in {200, 201, 204}:
            raise LabError('PROXY_CONTROL_FAILED', 503)
        value = response.json()
        if method == 'GET' and suffix == '' and not is_lab_proxy(value):
            raise LabError('PROXY_TARGET_CHANGED', 503)
        return value

    def definition(self, mutate: bool) -> dict[str, Any]:
        with self.oracle.connection(owner=True) as conn:
            original, recorded_hash = conn.execute('SELECT original_definition,original_sha256 '
                                                   'FROM p09a_guard.instance WHERE singleton=1 FOR UPDATE').fetchone()
            if digest(original.encode()) != recorded_hash:
                raise LabError('D02_BACKUP_INTEGRITY_FAILURE', 503)
            variant = mutate_definition(original)
            current = conn.execute('SELECT pg_get_functiondef(%s::regprocedure)', (FUNCTION,)).fetchone()[0]
            if current not in {original, variant}:
                # Never overwrite an unrecognized concurrent change.
                raise LabError('D02_UNRECOGNIZED_DATABASE_CHANGE', 503)
            desired = variant if mutate else original
            if current != desired:
                conn.execute(desired, prepare=False)
            observed = conn.execute('SELECT pg_get_functiondef(%s::regprocedure)', (FUNCTION,)).fetchone()[0]
            if observed != desired:
                raise LabError('D02_DEFINITION_READBACK_FAILED', 503)
        return {'originalFunctionSha256': recorded_hash, 'currentFunctionSha256': digest(observed.encode()),
                'mutantFunctionSha256': digest(variant.encode())}

    def reset(self) -> dict[str, Any]:
        # Reset network first even when schema validation subsequently fails.
        current = self.proxy()
        if not is_lab_proxy(current):
            raise LabError('PROXY_TARGET_CHANGED', 503)
        for toxic in current.get('toxics', []):
            if toxic.get('name') != TOXIC_NAME:
                raise LabError('UNRECOGNIZED_TOXIC', 503)
            self.proxy('DELETE', '/toxics/' + TOXIC_NAME)
        if current.get('enabled') is not True:
            self.proxy('POST', payload={'enabled': True})
        proof = self.definition(False)
        observed = self.proxy()
        proof.update(proxyEnabled=observed.get('enabled'), toxics=observed.get('toxics', []), restored=True)
        if not is_lab_proxy(observed) or proof['proxyEnabled'] is not True or proof['toxics']:
            raise LabError('PROXY_RESET_READBACK_FAILED', 503)
        return proof

    def activate(self, mode: str) -> dict[str, Any]:
        if mode == 'D02':
            proof = self.definition(True)
        elif mode == 'F01_LATENCY':
            self.proxy('POST', '/toxics', {'name': TOXIC_NAME, 'type': 'latency', 'stream': 'downstream',
                                          'toxicity': 1.0, 'attributes': {'latency': 250, 'jitter': 0}})
            proof = {'proxy': self.proxy()}
            toxics = proof['proxy'].get('toxics', [])
            if len(toxics) != 1 or toxics[0].get('attributes', {}).get('latency') != 250:
                raise LabError('LATENCY_ACTIVATION_NOT_OBSERVED', 503)
        elif mode == 'F01_DISCONNECT':
            self.proxy('POST', payload={'enabled': False})
            proof = {'proxy': self.proxy()}
            if proof['proxy'].get('enabled') is not False:
                raise LabError('DISCONNECT_ACTIVATION_NOT_OBSERVED', 503)
        else:
            raise LabError('INVALID_FAULT')
        return proof


def lease_is_safe(lease: dict[str, Any], run: dict[str, Any] | None, now: float) -> bool:
    return bool(run and run['status'] == 'RUNNING' and not run['cancelled']
                and now < run['deadline'] and 0 < lease['expires'] - now <= FAULT_SECONDS
                and 0 <= now - lease['worker'] <= 8)


class Guardian:
    def __init__(self, store: Store, driver: Driver):
        self.store, self.driver = store, driver
        self.last_mode = 'UNKNOWN'
        self.last_generation = -1

    def startup(self) -> None:
        # Independent restart restoration is mandatory; stale intent is not reactivated.
        generation = self.store.reset()
        proof = self.driver.reset()
        self.store.acknowledge(generation, 'NONE', proof)
        self.last_mode, self.last_generation = 'NONE', generation

    def tick(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        lease = self.store.lease()
        run = self.store.get(lease['run_id']) if lease['run_id'] else None
        if lease['desired'] != 'NONE' and not lease_is_safe(lease, run, now):
            self.store.reset()
            lease = self.store.lease()
        mode, generation = lease['desired'], lease['generation']
        if generation != self.last_generation or mode != self.last_mode:
            if mode == 'NONE':
                proof = self.driver.reset()
            else:
                # Every activation starts from a verified corrected baseline.
                self.driver.reset()
                proof = self.driver.activate(mode)
            if not self.store.acknowledge(generation, mode, proof):
                # A reset raced with activation: undo it before the next loop.
                self.driver.reset()
                self.last_mode, self.last_generation = 'UNKNOWN', -1
                return
            self.last_mode, self.last_generation = mode, generation
        self.store.heartbeat('guardian', now)


def main() -> int:
    settings = Settings.environment()
    store = Store(settings.state_dir)
    guardian = Guardian(store, Driver(settings))
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    while not stop.is_set():
        try:
            guardian.startup()
            break
        except Exception as error:
            store.guardian_error(error.code if isinstance(error, LabError) else type(error).__name__)
            stop.wait(1)
    try:
        while not stop.wait(0.25):
            try:
                guardian.tick()
            except Exception as error:
                store.guardian_error(error.code if isinstance(error, LabError) else type(error).__name__)
                guardian.last_mode, guardian.last_generation = 'UNKNOWN', -1
    finally:
        try:
            generation = store.reset()
            store.acknowledge(generation, 'NONE', guardian.driver.reset())
        except Exception:
            store.guardian_error('SHUTDOWN_CLEANUP_FAILED')
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
