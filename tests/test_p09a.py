"""P09A component regressions. Fakes here NEVER count as F01/D02 live evidence."""
from __future__ import annotations
import copy
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lab-support/p09a'))
from core import (LabError, Settings, Store, canonical, classify_defect, digest, junit,
                  require, run_case, valid_uuid, validate_result)
from guardian import CLAUSE, MUTANT, Guardian, lease_is_safe, mutate_definition
from server import cookies, csrf_token, validate_boundary

ACTOR = '00000000-0000-0000-0000-000000000004'
SOURCE = 'a' * 40
HASH = 'a' * 64
INSTANCE = 'a' * 32
ORIGIN = 'http://127.0.0.1:8090'
CLEAN = {'restored': True, 'originalFunctionSha256': HASH, 'currentFunctionSha256': HASH,
         'proxyEnabled': True, 'toxics': []}


def phase(status='PASS'):
    return {'status': status, 'testId': 'D02_PAYLOAD_CONFLICT', 'inputSha256': HASH,
            'observations': {'financialStateUnchanged': True}}


def evidence():
    mutant = phase('ASSERTION_FAILURE')
    mutant['assertion'] = {'id': 'D02_CHANGED_RECIPIENT_REJECTED', 'expected': 409, 'actual': 201}
    run_id = str(uuid.uuid4())
    inputs = {'seed': 74021, 'key': 'p09a:' + run_id,
              'original': {'recipientRef': 'first'}, 'changed': {'recipientRef': 'second'}}
    phases = {'baseline': phase(), 'mutant': mutant, 'restored': phase()}
    for item in phases.values(): item['inputSha256'] = digest(canonical(inputs).encode())
    return {'schemaVersion': 1, 'instanceId': INSTANCE, 'seed': 74021, 'input': inputs,
            'scenario': 'D02', 'runId': run_id, 'sourceSha': SOURCE, 'dirtySource': False,
            'verdict': 'DETECTED', 'cleanup': copy.deepcopy(CLEAN),
            'activation': {'mode': 'D02', 'originalFunctionSha256': HASH,
                           'currentFunctionSha256': 'b' * 64, 'mutantFunctionSha256': 'b' * 64},
            'phases': phases}


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name))
        self.ready()

    def tearDown(self):
        self.temp.cleanup()

    def ready(self):
        generation = self.store.lease()['generation']
        self.store.acknowledge(generation, 'NONE', CLEAN)
        self.store.heartbeat('guardian'); self.store.heartbeat('worker')

    def submit(self, scenario='D02', request_id=None):
        return self.store.submit(ACTOR, request_id or str(uuid.uuid4()), scenario)

    def running(self, scenario='D02'):
        row = self.submit(scenario)
        self.assertEqual(self.store.claim()['id'], row['id'])
        return row['id']

    def test_state_is_durable(self):
        row = self.submit()
        reopened = Store(Path(self.temp.name))
        self.assertEqual(reopened.get(row['id'])['request_id'], row['request_id'])

    def test_state_file_private(self):
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)

    def test_same_request_returns_same_run(self):
        row = self.submit()
        again = self.submit(request_id=row['request_id'])
        self.assertEqual(row['id'], again['id'])
        self.assertEqual(len(self.store.recent()), 1)

    def test_changed_request_payload_conflicts(self):
        row = self.submit()
        with self.assertRaisesRegex(LabError, 'REQUEST_ID_CONFLICT'):
            self.submit('F01', row['request_id'])

    def test_one_active_run(self):
        self.submit()
        with self.assertRaisesRegex(LabError, 'EXPERIMENT_ALREADY_ACTIVE'):
            self.submit()

    def test_concurrent_submission_has_one_winner(self):
        barrier = threading.Barrier(4)
        results = []
        def submit():
            barrier.wait()
            try:
                self.submit(); results.append('accepted')
            except LabError as error:
                results.append(error.code)
        threads = [threading.Thread(target=submit) for _ in range(4)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(results.count('accepted'), 1)
        self.assertEqual(results.count('EXPERIMENT_ALREADY_ACTIVE'), 3)

    def test_concurrent_same_request_replays(self):
        barrier = threading.Barrier(4)
        request_id = str(uuid.uuid4()); results = []
        def submit():
            barrier.wait(); results.append(self.submit(request_id=request_id)['id'])
        threads = [threading.Thread(target=submit) for _ in range(4)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(len(set(results)), 1)

    def test_stale_guardian_rejects_new_work(self):
        self.store.heartbeat('guardian', time.time() - 10)
        with self.assertRaisesRegex(LabError, 'LAB_NOT_READY'): self.submit()

    def test_stale_worker_rejects_new_work(self):
        self.store.heartbeat('worker', time.time() - 10)
        with self.assertRaisesRegex(LabError, 'LAB_NOT_READY'): self.submit()

    def test_future_heartbeat_rejected(self):
        self.store.heartbeat('guardian', time.time() + 10)
        with self.assertRaisesRegex(LabError, 'LAB_NOT_READY'): self.submit()

    def test_unimplemented_scenario_rejected(self):
        with self.assertRaisesRegex(LabError, 'UNIMPLEMENTED'): self.submit('D24')

    def test_unknown_seed_rejected(self):
        with self.assertRaisesRegex(LabError, 'UNIMPLEMENTED'):
            self.store.submit(ACTOR, str(uuid.uuid4()), 'D02', 12)

    def test_boolean_seed_rejected(self):
        with self.assertRaises(LabError): self.store.submit(ACTOR, str(uuid.uuid4()), 'F01', True)

    def test_cancelled_run_cannot_activate(self):
        run_id = self.running(); self.store.reset(run_id, cancel=True)
        with self.assertRaisesRegex(LabError, 'CANCELLED'): self.store.request_fault(run_id, 'D02')

    def test_expired_run_cannot_activate(self):
        run_id = self.running()
        with self.store.db(write=True) as db: db.execute('UPDATE runs SET deadline=0 WHERE id=?', (run_id,))
        with self.assertRaisesRegex(LabError, 'EXPIRED'): self.store.request_fault(run_id, 'D02')

    def test_scenario_scope_enforced(self):
        run_id = self.running()
        with self.assertRaisesRegex(LabError, 'FAULT_SCOPE_MISMATCH'):
            self.store.request_fault(run_id, 'F01_LATENCY')

    def test_fault_duration_bounded(self):
        run_id = self.running()
        for seconds in (0, -1, 21, True, 1.5):
            with self.subTest(seconds=seconds), self.assertRaises(LabError):
                self.store.request_fault(run_id, 'D02', seconds)

    def test_only_fixed_fault_modes(self):
        run_id = self.running()
        for mode in ('NONE', 'shell', 'https://example.test', 'F08'):
            with self.subTest(mode=mode), self.assertRaises(LabError): self.store.request_fault(run_id, mode)

    def test_reset_invalidates_old_acknowledgement(self):
        run_id = self.running()
        old = self.store.request_fault(run_id, 'D02')
        new = self.store.reset(run_id)
        self.assertFalse(self.store.acknowledge(old, 'D02', {}))
        self.assertTrue(self.store.acknowledge(new, 'NONE', CLEAN))

    def test_second_activation_waits_for_restoration(self):
        run_id = self.running()
        generation = self.store.request_fault(run_id, 'D02')
        self.store.acknowledge(generation, 'D02', {})
        with self.assertRaisesRegex(LabError, 'FAULT_BUSY'):
            self.store.request_fault(run_id, 'D02')

    def test_finished_verdict_cannot_hide_active_fault(self):
        run_id = self.running()
        self.store.request_fault(run_id, 'D02')
        value = evidence(); value['runId'] = run_id
        self.store.finish(run_id, value)
        self.assertEqual(self.store.get(run_id)['status'], 'CLEANUP_FAILED')

    def test_unknown_verdict_rejected(self):
        run_id = self.running()
        with self.assertRaises(ValueError): self.store.finish(run_id, {'verdict': 'MAGIC_SUCCESS'})

    def test_guardian_error_forces_reset(self):
        run_id = self.running(); self.store.request_fault(run_id, 'D02')
        self.store.guardian_error('READBACK_FAILED')
        self.assertEqual(self.store.lease()['desired'], 'NONE')
        self.assertFalse(self.store.health()['guardianReady'])

    def test_restart_marks_interrupted_runs(self):
        run_id = self.running(); self.store.request_fault(run_id, 'D02')
        self.store.recover_interrupted()
        self.assertEqual(self.store.get(run_id)['cancelled'], 1)
        self.assertEqual(self.store.lease()['desired'], 'NONE')

    def test_missing_run_is_not_empty_success(self):
        with self.assertRaisesRegex(LabError, 'RUN_NOT_FOUND'): self.store.get(str(uuid.uuid4()))

    def test_untrusted_process_column_rejected(self):
        with self.assertRaises(ValueError): self.store.heartbeat('worker=1; DROP TABLE runs')


class FakeDriver:
    def __init__(self):
        self.mode = 'NONE'; self.resets = 0; self.on_activate = None
    def reset(self):
        self.mode = 'NONE'; self.resets += 1; return copy.deepcopy(CLEAN)
    def activate(self, mode):
        self.mode = mode
        if self.on_activate: self.on_activate()
        return {'mode': mode}


# Reuse fixture helpers without rediscovering the state tests.
class GuardianTests(unittest.TestCase):
    setUp, tearDown, ready, submit, running = (StateTests.setUp, StateTests.tearDown,
                                              StateTests.ready, StateTests.submit, StateTests.running)
    def guardian(self):
        driver = FakeDriver(); guardian = Guardian(self.store, driver)
        guardian.startup(); self.store.heartbeat('worker')
        return guardian, driver

    def test_actual_driver_reset_precedes_activation(self):
        guardian, driver = self.guardian(); run_id = self.running()
        self.store.request_fault(run_id, 'D02'); guardian.tick()
        self.assertEqual(driver.mode, 'D02'); self.assertGreaterEqual(driver.resets, 2)

    def test_expired_lease_restores_without_controller(self):
        guardian, driver = self.guardian(); run_id = self.running()
        self.store.request_fault(run_id, 'D02'); guardian.tick()
        guardian.tick(self.store.lease()['expires'] + .01)
        self.assertEqual(driver.mode, 'NONE'); self.assertEqual(self.store.lease()['applied'], 'NONE')

    def test_missing_worker_heartbeat_restores(self):
        guardian, driver = self.guardian(); run_id = self.running()
        self.store.request_fault(run_id, 'D02'); guardian.tick()
        self.store.heartbeat('worker', time.time() - 9); guardian.tick()
        self.assertEqual(driver.mode, 'NONE')

    def test_reset_racing_activation_is_undone(self):
        guardian, driver = self.guardian(); run_id = self.running()
        self.store.request_fault(run_id, 'D02')
        driver.on_activate = lambda: self.store.reset(run_id)
        guardian.tick()
        self.assertEqual(driver.mode, 'NONE')
        self.assertNotEqual(self.store.lease()['applied'], 'D02')
        guardian.tick(); self.assertEqual(self.store.lease()['applied'], 'NONE')

    def test_guardian_restart_does_not_reactivate_mutant(self):
        guardian, driver = self.guardian(); run_id = self.running()
        self.store.request_fault(run_id, 'D02'); guardian.tick()
        Guardian(self.store, driver).startup()
        self.assertEqual(driver.mode, 'NONE'); self.assertEqual(self.store.lease()['desired'], 'NONE')

    def test_cancel_triggers_restoration(self):
        guardian, driver = self.guardian(); run_id = self.running('F01')
        self.store.request_fault(run_id, 'F01_DISCONNECT'); guardian.tick()
        self.store.reset(run_id, cancel=True); guardian.tick()
        self.assertEqual(driver.mode, 'NONE')

    def test_backward_clock_does_not_extend_fault(self):
        guardian, driver = self.guardian(); run_id = self.running()
        self.store.request_fault(run_id, 'D02'); guardian.tick()
        guardian.tick(time.time() - 30)
        self.assertEqual(driver.mode, 'NONE')

    def test_missing_run_never_safe(self):
        self.assertFalse(lease_is_safe({}, None, time.time()))

    def test_mutation_requires_unique_known_sql(self):
        original = 'CREATE OR REPLACE FUNCTION ledger.execute_command()\n' + CLAUSE
        self.assertIn(MUTANT, mutate_definition(original))
        for value in (original + CLAUSE, original.replace(CLAUSE, 'other code'), mutate_definition(original),
                      'DROP DATABASE ledgerguard; ' + CLAUSE):
            with self.subTest(value=value), self.assertRaises(LabError): mutate_definition(value)


class EvidenceTests(unittest.TestCase):
    def test_valid_triplet_detected(self):
        value = evidence(); validate_result(value, SOURCE)
        self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'DETECTED')

    def test_baseline_failure_not_detected(self):
        value = evidence(); value['phases']['baseline']['status'] = 'ERROR'
        self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'BASELINE_FAILED')

    def test_restoration_failure_not_detected(self):
        value = evidence(); value['phases']['restored']['status'] = 'ERROR'
        self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'CLEANUP_FAILED')

    def test_survivor_not_detected(self):
        value = evidence(); value['phases']['mutant'] = phase()
        self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'SURVIVED')

    def test_compile_setup_timeout_never_count(self):
        for status in ('ERROR', 'TIMEOUT', 'SKIPPED'):
            value = evidence(); value['phases']['mutant']['status'] = status
            with self.subTest(status=status):
                self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'INVALID_EXPERIMENT')

    def test_wrong_assertion_not_counted(self):
        value = evidence(); value['phases']['mutant']['assertion']['id'] = 'MUTANT_FLAG_ENABLED'
        self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'INVALID_EXPERIMENT')

    def test_secondary_defense_not_claimed_duplicate_money(self):
        value = evidence(); value['phases']['mutant']['assertion']['actual'] = 503
        self.assertEqual(classify_defect(value['phases'], value['cleanup']), 'INVALID_EXPERIMENT')

    def test_changed_input_not_counted(self):
        value = evidence(); value['phases']['mutant']['inputSha256'] = 'b' * 64
        with self.assertRaises(LabError): validate_result(value)

    def test_changed_financial_state_not_expected_detection(self):
        value = evidence(); value['phases']['mutant']['observations']['financialStateUnchanged'] = False
        with self.assertRaises(LabError): validate_result(value)

    def test_wrong_source_not_counted(self):
        with self.assertRaisesRegex(LabError, 'SOURCE_MISMATCH'): validate_result(evidence(), 'c' * 40)

    def test_dirty_source_not_counted(self):
        value = evidence(); value['dirtySource'] = True
        with self.assertRaisesRegex(LabError, 'DIRTY_SOURCE'): validate_result(value)

    def test_missing_mutant_phase_not_counted(self):
        value = evidence(); del value['phases']['mutant']
        with self.assertRaises(LabError): validate_result(value)

    def test_missing_activation_not_counted(self):
        value = evidence(); value['activation'] = {}
        with self.assertRaises(LabError): validate_result(value)

    def test_cleanup_hash_mismatch_not_counted(self):
        value = evidence(); value['cleanup']['currentFunctionSha256'] = 'c' * 64
        with self.assertRaises(LabError): validate_result(value)

    def test_remaining_toxic_not_counted(self):
        value = evidence(); value['cleanup']['toxics'] = [{'name': 'remaining'}]
        with self.assertRaises(LabError): validate_result(value)

    def test_junit_preserves_real_red_mutant(self):
        xml = ET.fromstring(junit(evidence()))
        self.assertEqual(xml.get('tests'), '3'); self.assertEqual(xml.get('failures'), '1')
        failures = xml.findall('.//failure')
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].get('message'), 'D02_CHANGED_RECIPIENT_REJECTED')

    def test_timeout_junit_is_error_not_failure(self):
        value = evidence(); value['phases']['mutant']['status'] = 'TIMEOUT'
        xml = ET.fromstring(junit(value))
        self.assertEqual(xml.get('errors'), '1'); self.assertEqual(xml.get('failures'), '0')

    def test_case_retains_contract_assertion(self):
        def case(_): require(False, 'EXPECTED_409', 409, 201)
        result = run_case('case', case, HASH)
        self.assertEqual(result['status'], 'ASSERTION_FAILURE')
        self.assertEqual(result['assertion']['actual'], 201)

    def test_setup_error_does_not_leak_password(self):
        def case(_): raise RuntimeError('password=DO_NOT_PUBLISH')
        result = run_case('case', case, HASH)
        self.assertEqual(result['status'], 'ERROR')
        self.assertNotIn('DO_NOT_PUBLISH', canonical(result))

    def test_timeout_does_not_count_as_assertion(self):
        def case(_): raise TimeoutError('secret DSN')
        result = run_case('case', case, HASH)
        self.assertEqual(result['status'], 'TIMEOUT')
        self.assertNotIn('secret', canonical(result))

    def test_f01_incomplete_campaign_rejected(self):
        value = evidence(); value['scenario'] = 'F01'; value['verdict'] = 'PASSED'
        with self.assertRaises(LabError): validate_result(value)


class BoundaryTests(unittest.TestCase):
    def headers(self): return {'Host': '127.0.0.1:8090', 'Origin': ORIGIN}

    def test_loopback_origin_allowed(self):
        validate_boundary('POST', '/lab/api/runs', self.headers(), ORIGIN)

    def test_wrong_host_rejected(self):
        headers = self.headers(); headers['Host'] = 'evil.example'
        with self.assertRaisesRegex(LabError, 'LOOPBACK'): validate_boundary('GET', '/lab/', headers, ORIGIN)

    def test_cross_site_rejected(self):
        headers = self.headers(); headers['Sec-Fetch-Site'] = 'cross-site'
        with self.assertRaisesRegex(LabError, 'CROSS_SITE'): validate_boundary('GET', '/lab/api/runs', headers, ORIGIN)

    def test_missing_origin_rejected_on_write(self):
        with self.assertRaisesRegex(LabError, 'ORIGIN'):
            validate_boundary('POST', '/lab/api/runs', {'Host': '127.0.0.1:8090'}, ORIGIN)

    def test_wrong_origin_rejected(self):
        headers = self.headers(); headers['Origin'] = 'http://127.0.0.1:3000'
        with self.assertRaisesRegex(LabError, 'ORIGIN'): validate_boundary('POST', '/lab/api/runs', headers, ORIGIN)

    def test_path_expansion_rejected(self):
        for path in ('/lab/../etc/passwd', '/lab/%2e%2e', '/lab/api/runs?url=https://evil', '/lab/\\evil', '/lab/#fragment'):
            with self.subTest(path=path), self.assertRaises(LabError):
                validate_boundary('GET', path, self.headers(), ORIGIN)

    def test_chunked_request_rejected(self):
        headers = self.headers(); headers['Transfer-Encoding'] = 'chunked'
        with self.assertRaises(LabError): validate_boundary('POST', '/lab/api/runs', headers, ORIGIN)

    def test_normal_application_cookie_not_forwarded(self):
        result = cookies('LG-SESSION=normal; P09A-SESSION=isolated; unrelated=something')
        self.assertEqual(result, {'P09A-SESSION': 'isolated'})

    def test_csrf_binds_session(self):
        key = bytes.fromhex('ab' * 32)
        self.assertNotEqual(csrf_token('one', ORIGIN, key), csrf_token('two', ORIGIN, key))

    def test_csrf_binds_origin(self):
        key = bytes.fromhex('ab' * 32)
        self.assertNotEqual(csrf_token('session', ORIGIN, key), csrf_token('session', 'http://127.0.0.1:9090', key))

    def test_csrf_requires_authenticated_session(self):
        with self.assertRaises(LabError): csrf_token('', ORIGIN, b'a' * 32)

    def test_uuid_canonicalization(self):
        value = str(uuid.uuid4()); self.assertEqual(valid_uuid(value), value)
        for bad in (None, 'x', value.upper(), value.replace('-', ''), 3):
            with self.subTest(value=bad), self.assertRaises(LabError): valid_uuid(bad)

    def test_lab_build_marker_required(self):
        env = {'LEDGER_LAB_ENABLED': 'true', 'LEDGER_LAB_INSTANCE': INSTANCE,
               'LEDGER_LAB_SOURCE': SOURCE, 'LEDGER_LAB_ORIGIN': ORIGIN}
        with patch.dict(os.environ, env, clear=True), patch('core.Path.is_file', return_value=False):
            with self.assertRaisesRegex(LabError, 'BUILD_AND_ENABLEMENT'): Settings.environment()

    def test_lab_server_enablement_required(self):
        with patch.dict(os.environ, {}, clear=True), patch('core.Path.is_file', return_value=True):
            with self.assertRaises(LabError): Settings.environment()

    def test_lab_settings_reject_external_origin(self):
        env = {'LEDGER_LAB_ENABLED': 'true', 'LEDGER_LAB_INSTANCE': INSTANCE,
               'LEDGER_LAB_SOURCE': SOURCE, 'LEDGER_LAB_ORIGIN': 'http://0.0.0.0:8090'}
        with patch.dict(os.environ, env, clear=True), patch('core.Path.is_file', return_value=True):
            with self.assertRaisesRegex(LabError, 'LOOPBACK'): Settings.environment()

    def test_lab_settings_require_provenance(self):
        env = {'LEDGER_LAB_ENABLED': 'true', 'LEDGER_LAB_INSTANCE': INSTANCE,
               'LEDGER_LAB_SOURCE': 'main', 'LEDGER_LAB_ORIGIN': ORIGIN}
        with patch.dict(os.environ, env, clear=True), patch('core.Path.is_file', return_value=True):
            with self.assertRaisesRegex(LabError, 'PROVENANCE'): Settings.environment()


class OrchestrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        loader = importlib.machinery.SourceFileLoader('verify_product', str(ROOT / 'scripts/verify-product'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        cls.module = importlib.util.module_from_spec(spec); loader.exec_module(cls.module)

    def test_pr_uses_current_evidence_gate(self):
        commands = self.module.campaign('pr')
        self.assertIn(['python3', 'scripts/assert-p08f-evidence'], commands)
        self.assertNotIn(['python3', 'scripts/assert-p06-evidence'], commands)

    def test_e2e_activates_schedule_and_webhook_services(self):
        commands = self.module.campaign('e2e')
        flattened = [item for command in commands for item in command]
        for service in ('scheduler-a', 'scheduler-b', 'receiver', 'webhook-dispatcher-a', 'webhook-dispatcher-b'):
            self.assertIn(service, flattened)
        self.assertIn('compose.p08c-test.yaml', flattened)

    def test_cleanup_failure_fails_campaign(self):
        with patch.object(self.module, 'preparation', return_value=[]), patch.object(self.module, 'campaign', return_value=[['true']]), \
             patch.object(self.module, 'execute', return_value=0), patch.object(self.module, 'collect', return_value=0), \
             patch.object(self.module, 'stop', return_value=7):
            self.assertEqual(self.module.verify('pr'), 7)

    def test_required_failure_preserved_and_cleanup_executed(self):
        with patch.object(self.module, 'preparation', return_value=[]), patch.object(self.module, 'campaign', return_value=[['false']]), \
             patch.object(self.module, 'execute', return_value=5), patch.object(self.module, 'collect', return_value=0), \
             patch.object(self.module, 'stop', return_value=0) as cleanup:
            self.assertEqual(self.module.verify('pr'), 5); cleanup.assert_called_once()


if __name__ == '__main__': unittest.main()
