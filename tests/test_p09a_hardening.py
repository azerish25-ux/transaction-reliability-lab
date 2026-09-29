"""Regression probes for actual lab code; synthetic artifacts are NOT live proof."""
from __future__ import annotations

from contextlib import contextmanager
import copy
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lab-support/p09a'))
from core import LabError, Store, canonical, digest, junit, validate_result
from guardian import Guardian
from evidence_integrity import EvidenceIntegrityError
from test_p09a_evidence_integrity import png
from test_p09a import ACTOR, CLEAN, FakeDriver, HASH, INSTANCE, SOURCE, evidence, phase

# Load the real command, rather than duplicating its validation in the test.
loader = importlib.machinery.SourceFileLoader('p09a_evidence_gate', str(ROOT / 'scripts/assert-p09a-evidence'))
spec = importlib.util.spec_from_loader(loader.name, loader)
gate = importlib.util.module_from_spec(spec)
loader.exec_module(gate)
loader = importlib.machinery.SourceFileLoader('p09a_packaging', str(ROOT / 'lab-support/p09a/packaging.py'))
spec = importlib.util.spec_from_loader(loader.name, loader)
packaging = importlib.util.module_from_spec(spec)
loader.exec_module(packaging)


def complete_evidence(scenario='D02'):
    """Synthetic, deliberately small evidence fixture for validator tests only."""
    value = evidence()
    value.update(schemaVersion=1, instanceId=INSTANCE, seed=74021,
                 input={'seed': 74021, 'key': 'p09a:' + value['runId'],
                        'original': {'recipientRef': 'first', 'amountMinor': '30', 'currency': 'CAD'},
                        'changed': {'recipientRef': 'second', 'amountMinor': '30', 'currency': 'CAD'}})
    for item in value['phases'].values():
        item['inputSha256'] = digest(canonical(value['input']).encode())
    if scenario == 'F01':
        value.update(scenario='F01', verdict='PASSED')
        value['phases'] = {name: phase() for name in ('baseline', 'latency', 'disruption', 'restored')}
        for item in value['phases'].values():
            item.update(testId='F01_DATABASE_RECOVERY', inputSha256=digest(canonical(value['input']).encode()))
        value['routeProof'] = {'proved': True, 'database': 'ledgerguard_lab_' + INSTANCE[:12],
                               'proxyAddresses': ['172.20.0.3'],
                               'targetConnections': [[101, '172.20.0.3', 'LedgerGuard-P09A-Target']]}
        value['activation'] = {
            'latency': {'proxy': {'enabled': True, 'toxics': [{'type': 'latency', 'stream': 'downstream',
                                                            'attributes': {'latency': 250}}]}},
            'disruption': {'proxy': {'enabled': False}}}
    return value


class LeaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name))
        self.driver = FakeDriver()
        self.guardian = Guardian(self.store, self.driver)
        self.guardian.startup()
        self.store.heartbeat('worker')
        self.run_id = self.store.submit(ACTOR, str(uuid.uuid4()), 'D02')['id']
        self.store.claim()

    def tearDown(self):
        self.temp.cleanup()

    def assert_restored(self):
        lease = self.store.lease()
        self.assertEqual(self.driver.mode, 'NONE')
        self.assertEqual(lease['desired'], 'NONE')
        self.assertNotEqual(lease['applied'], 'D02')

    def test_deadline_is_exclusive(self):
        deadline = self.store.get(self.run_id)['deadline']
        with patch('core.time.time', return_value=deadline):
            with self.assertRaisesRegex(LabError, 'EXPIRED'):
                self.store.check_run(self.run_id)

    def test_preparation_cannot_activate_a_lease_that_expired_during_io(self):
        self.store.request_fault(self.run_id, 'D02')
        clock = [time.time()]
        reset = self.driver.reset
        def slow_reset():
            result = reset()
            clock[0] += 21
            return result
        with patch('core.time.time', side_effect=lambda: clock[0]), \
             patch.object(self.driver, 'reset', side_effect=slow_reset), \
             patch.object(self.driver, 'activate', wraps=self.driver.activate) as activate:
            self.guardian.tick()
        activate.assert_not_called()
        self.assert_restored()

    def test_cancellation_during_preparation_prevents_activation(self):
        self.store.request_fault(self.run_id, 'D02')
        reset = self.driver.reset
        fired = [False]
        def cancelled_reset():
            result = reset()
            if not fired[0]:
                fired[0] = True
                self.store.reset(self.run_id, cancel=True)
            return result
        with patch.object(self.driver, 'reset', side_effect=cancelled_reset), \
             patch.object(self.driver, 'activate', wraps=self.driver.activate) as activate:
            self.guardian.tick()
        activate.assert_not_called()
        self.assert_restored()

    def test_expiry_during_activation_is_restored_before_tick_returns(self):
        self.store.request_fault(self.run_id, 'D02')
        clock = [time.time()]
        self.driver.on_activate = lambda: clock.__setitem__(0, clock[0] + 21)
        with patch('core.time.time', side_effect=lambda: clock[0]):
            self.guardian.tick()
        self.assert_restored()

    def test_worker_loss_during_activation_is_not_acknowledged(self):
        self.store.request_fault(self.run_id, 'D02')
        self.driver.on_activate = lambda: self.store.heartbeat('worker', time.time() - 9)
        self.guardian.tick()
        self.assert_restored()

    def test_acknowledgement_checks_expiry_inside_write_transaction(self):
        generation = self.store.request_fault(self.run_id, 'D02')
        deadline = self.store.lease()['expires']
        with patch('core.time.time', return_value=deadline):
            self.assertFalse(self.store.acknowledge(generation, 'D02', {}))
        self.assertNotEqual(self.store.lease()['applied'], 'D02')

    def test_acknowledgement_rejects_a_different_mode_for_same_generation(self):
        generation = self.store.request_fault(self.run_id, 'D02')
        self.assertFalse(self.store.acknowledge(generation, 'F01_DISCONNECT', {}))

    def test_cancelled_run_is_rechecked_after_acquiring_write_lock(self):
        original = self.store.db
        first = [True]
        @contextmanager
        def raced_db(write=False):
            if write and first[0]:
                first[0] = False
                # A cancellation and guardian restoration complete before the requester gets the lock.
                with original(write=True) as db:
                    db.execute('UPDATE runs SET cancelled=1 WHERE id=?', (self.run_id,))
                    db.execute('UPDATE lease SET generation=generation+1,applied_generation=applied_generation+1')
            with original(write=write) as db:
                yield db
        with patch.object(self.store, 'db', side_effect=raced_db):
            with self.assertRaisesRegex(LabError, 'CANCELLED'):
                self.store.request_fault(self.run_id, 'D02')
        self.assertEqual(self.store.lease()['desired'], 'NONE')

    def test_deadline_is_rechecked_after_acquiring_write_lock(self):
        original = self.store.db
        first = [True]
        @contextmanager
        def raced_db(write=False):
            if write and first[0]:
                first[0] = False
                with original(write=True) as db:
                    db.execute('UPDATE runs SET deadline=0 WHERE id=?', (self.run_id,))
            with original(write=write) as db:
                yield db
        with patch.object(self.store, 'db', side_effect=raced_db):
            with self.assertRaisesRegex(LabError, 'EXPIRED'):
                self.store.request_fault(self.run_id, 'D02')
        self.assertEqual(self.store.lease()['desired'], 'NONE')


class ResultProvenanceTests(unittest.TestCase):
    def test_complete_d02_is_valid(self):
        validate_result(complete_evidence(), SOURCE)

    def test_complete_f01_is_valid(self):
        validate_result(complete_evidence('F01'), SOURCE)

    def test_recorded_input_must_match_executed_input_hash(self):
        value = complete_evidence()
        value['input']['changed']['amountMinor'] = '999'
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_missing_recorded_input_is_rejected(self):
        value = complete_evidence(); del value['input']
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_input_key_is_bound_to_run(self):
        value = complete_evidence(); value['input']['key'] = 'p09a:' + str(uuid.uuid4())
        for entry in value['phases'].values(): entry['inputSha256'] = digest(canonical(value['input']).encode())
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_instance_identity_cannot_be_omitted(self):
        value = complete_evidence(); del value['instanceId']
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_f01_different_phase_inputs_are_rejected(self):
        value = complete_evidence('F01'); value['phases']['disruption']['inputSha256'] = 'b' * 64
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_route_connections_must_actually_use_proxy(self):
        value = complete_evidence('F01'); value['routeProof']['targetConnections'][0][1] = '172.20.0.99'
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_route_connections_must_be_target_application(self):
        value = complete_evidence('F01'); value['routeProof']['targetConnections'][0][2] = 'psql'
        with self.assertRaises(LabError): validate_result(value, SOURCE)

    def test_route_database_must_match_disposable_instance(self):
        value = complete_evidence('F01'); value['routeProof']['database'] = 'ordinary_database'
        with self.assertRaises(LabError): validate_result(value, SOURCE)


class ArtifactGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.base = self.root / '.evidence/p09a'
        self.base.mkdir(parents=True)
        self.values = [complete_evidence('F01'), complete_evidence()]
        for value in self.values: self.write_run(value)
        self.write('summary.json', {'sourceSha': SOURCE, 'completeP09': False,
                   'implementedFaultsVerified': 1, 'validDefectsDetected': 1,
                   'requiredFaults': 8, 'requiredDefects': 24,
                   'runs': [{'id': v['runId'], 'scenario': v['scenario'], 'verdict': v['verdict']} for v in self.values]})
        browser_ids = ['UNAUTHENTICATED_LAB_DENIED', 'ADMIN_COMMAND_REQUIRES_CSRF',
                       'ADMIN_BROWSER_EXECUTES_REAL_F01', 'ADMIN_BROWSER_EXECUTES_REAL_D02',
                       'MOBILE_NO_HORIZONTAL_OVERFLOW', 'KEYBOARD_FOCUS_SURVIVES_POLL',
                       'AUTHENTICATED_CUSTOMER_LAB_DENIED', 'NO_BROWSER_PAGE_ERRORS']
        self.write('browser/results.json', {'sourceSha': SOURCE, 'scope': 'REAL_BROWSER_LIVE_LAB',
                    'complete': True, 'tests': [{'id': name, 'status': 'PASS'} for name in browser_ids]})
        for name in ('desktop.png', 'mobile.png'):
            (self.base / 'browser' / name).write_bytes(png())  # Synthetic fixture, not a browser screenshot.
        lifecycle = []
        for name, verdict in [('CONTROLLER_SIGKILL_GUARDIAN_RECOVERY', 'CANCELLED'),
                              ('REAL_MUTANT_AUTOMATIC_EXPIRY', 'SURVIVED')]:
            value = complete_evidence(); value['verdict'] = verdict
            self.write_run(value)
            lifecycle.append({'id': name, 'runId': value['runId'], 'status': 'PASS'})
        self.write('lifecycle.json', {'sourceSha': SOURCE, 'tests': lifecycle})
        (self.root / 'backend/target').mkdir(parents=True)
        (self.root / 'backend/target/ledgerguard.jar').write_bytes(b'synthetic packaging test fixture')
        (self.root / 'frontend/dist').mkdir(parents=True)
        (self.root / 'frontend/dist/index.html').write_text('synthetic frontend fixture')
        self.write('packaging.json', {'scope': 'P09A_SPECIFIC_EXCLUSION_ONLY', 'excluded': True,
                   'sourceSha': SOURCE, 'dirtySource': False,
                   'globalG12Complete': False, 'jarEntriesInspected': 1, 'frontendFilesInspected': 1,
                   'normalJarSha256': digest(b'synthetic packaging test fixture'),
                   'normalFrontendSha256': {'index.html': digest(b'synthetic frontend fixture')}})
        (self.root / 'compose.lab.yaml').write_text('synthetic topology fixture')
        self.write('images.json', {'sourceSha': SOURCE, 'dirtySource': False, 'instanceId': INSTANCE,
                   'imageIds': {s: 'sha256:' + HASH for s in ('postgres', 'toxiproxy', 'api', 'control-api', 'controller', 'guardian')},
                   'composeSha256': digest(b'synthetic topology fixture')})

    def tearDown(self): self.temp.cleanup()

    def write(self, name, value):
        path = self.base / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def write_run(self, value, xml=None):
        run_id = value['runId']; self.write(run_id + '/verdict.json', value)
        (self.base / run_id / 'results.xml').write_bytes(junit(value) if xml is None else xml)
        self.rehash(run_id)

    def rehash(self, run_id):
        self.write(run_id + '/manifest.json', {'sourceSha': SOURCE, 'runId': run_id,
                   'files': {name: digest((self.base / run_id / name).read_bytes()) for name in ('verdict.json', 'results.xml')}})

    def verify(self):
        with patch.object(gate, 'ROOT', self.root), patch.object(gate, 'BASE', self.base), \
             patch.object(gate.subprocess, 'check_output', side_effect=[SOURCE, '']), patch('builtins.print'):
            gate.verify()

    def edit_xml(self, change):
        path = self.base / self.values[1]['runId'] / 'results.xml'
        xml = ET.fromstring(path.read_bytes()); change(xml)
        path.write_bytes(ET.tostring(xml, encoding='utf-8', xml_declaration=True))
        self.rehash(self.values[1]['runId'])

    def test_consistent_synthetic_artifacts_pass_validator(self): self.verify()

    def test_missing_real_failure_cannot_hide_behind_suite_counter(self):
        def remove(xml):
            case = xml.find("testcase[@classname='D02.mutant']")
            case.remove(case.find('failure'))
        self.edit_xml(remove)
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_wrong_failing_assertion_is_rejected_even_after_rehash(self):
        self.edit_xml(lambda xml: xml.find('.//failure').set('message', 'UNRELATED_FAILURE'))
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_wrong_junit_source_is_rejected_even_after_rehash(self):
        self.edit_xml(lambda xml: xml.find(".//property[@name='sourceSha']").set('value', 'b' * 40))
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_duplicate_testcases_are_not_valid_coverage(self):
        def duplicate(xml):
            xml.remove(xml.findall('testcase')[-1]); xml.append(copy.deepcopy(xml.findall('testcase')[0]))
        self.edit_xml(duplicate)
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_lifecycle_artifact_hash_is_verified(self):
        life = json.loads((self.base / 'lifecycle.json').read_text())['tests'][0]
        path = self.base / life['runId'] / 'verdict.json'
        value = json.loads(path.read_text()); value['cleanup']['restored'] = True; value['reason'] = 'CHANGED_WITHOUT_REHASH'
        path.write_text(json.dumps(value))
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_frontend_changed_after_packaging_is_rejected(self):
        (self.root / 'frontend/dist/index.html').write_text('a different frontend')
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_frontend_added_after_packaging_is_rejected(self):
        (self.root / 'frontend/dist/extra.js').write_text('new artifact')
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()

    def test_lifecycle_requires_physical_function_hashes(self):
        life = json.loads((self.base / 'lifecycle.json').read_text())['tests'][0]
        value = json.loads((self.base / life['runId'] / 'verdict.json').read_text())
        del value['cleanup']['originalFunctionSha256']; del value['cleanup']['currentFunctionSha256']
        self.write_run(value)
        with self.assertRaises((LabError, EvidenceIntegrityError)): self.verify()


class PackagingBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / 'backend/target').mkdir(parents=True)
        (self.root / 'frontend/dist').mkdir(parents=True)
        (self.root / 'frontend/dist/index.html').write_text('<main>Normal product</main>')

    def tearDown(self): self.temp.cleanup()

    def jar(self, entries):
        with zipfile.ZipFile(self.root / 'backend/target/ledgerguard.jar', 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in entries.items(): archive.writestr(name, content)

    def inspect(self):
        with patch.object(packaging, 'ROOT', self.root), \
             patch.object(packaging.subprocess, 'check_output', side_effect=[SOURCE, '']):
            return packaging.inspect()

    def test_clean_normal_artifacts_are_accepted_with_scoped_claim(self):
        self.jar({'BOOT-INF/classes/Product.class': b'normal product'})
        self.assertFalse(self.inspect()['globalG12Complete'])

    def test_lab_code_in_nested_jar_cannot_escape_scan(self):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as archive: archive.writestr('payload.py', b'LAB_ONLY_BUILD')
        self.jar({'BOOT-INF/classes/Product.class': b'normal', 'BOOT-INF/lib/hidden.jar': nested.getvalue()})
        with self.assertRaises(LabError): self.inspect()

    def test_lab_path_is_rejected_without_marker_contents(self):
        self.jar({'BOOT-INF/classes/Product.class': b'normal',
                  'BOOT-INF/classes/lab-support/p09a/guardian.py': b'pass'})
        with self.assertRaises(LabError): self.inspect()

    def test_frontend_lab_filename_is_rejected_without_marker_contents(self):
        self.jar({'BOOT-INF/classes/Product.class': b'normal'})
        path = self.root / 'frontend/dist/lab-support/p09a'; path.mkdir(parents=True)
        (path / 'runner.py').write_text('pass')
        with self.assertRaises(LabError): self.inspect()

    def test_normal_nested_dependency_is_accepted(self):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as archive: archive.writestr('org/example/Library.class', b'ordinary dependency')
        self.jar({'BOOT-INF/classes/Product.class': b'normal', 'BOOT-INF/lib/dependency.jar': nested.getvalue()})
        self.assertTrue(self.inspect()['excluded'])

    def test_renamed_nested_archive_cannot_escape_scan(self):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('payload.py', b'LAB_ONLY_BUILD')
        self.jar({'BOOT-INF/classes/Product.class': b'normal', 'payload.bin': nested.getvalue()})
        with self.assertRaises(LabError): self.inspect()

    def test_frontend_compressed_lab_payload_cannot_escape_scan(self):
        self.jar({'BOOT-INF/classes/Product.class': b'normal'})
        with zipfile.ZipFile(self.root / 'frontend/dist/extra.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('payload.py', b'LAB_ONLY_BUILD')
        with self.assertRaises(LabError): self.inspect()

    def test_duplicate_archive_member_is_rejected(self):
        import warnings
        self.jar({'BOOT-INF/classes/Product.class': b'normal'})
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.root / 'backend/target/ledgerguard.jar', 'a') as archive:
                archive.writestr('BOOT-INF/classes/Product.class', b'replacement')
        with self.assertRaisesRegex(LabError, 'DUPLICATE_ENTRY'): self.inspect()

    def test_archive_entry_budget_is_enforced_before_read(self):
        self.jar({'large.bin': b'x' * 20})
        with patch.object(packaging, 'MAX_ENTRY_BYTES', 10):
            with self.assertRaisesRegex(LabError, 'BUDGET'): self.inspect()

    def test_archive_total_budget_is_enforced(self):
        self.jar({'one.bin': b'x' * 6, 'two.bin': b'y' * 6})
        with patch.object(packaging, 'MAX_TOTAL_BYTES', 10):
            with self.assertRaisesRegex(LabError, 'BUDGET'):
                packaging.scan_archive(self.root / 'backend/target/ledgerguard.jar',
                                       {'entries': 0, 'bytes': 0, 'archives': 1})

    def test_nested_archive_depth_is_bounded(self):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as archive: archive.writestr('data.txt', b'normal')
        self.jar({'nested.jar': nested.getvalue()})
        with patch.object(packaging, 'MAX_ARCHIVE_DEPTH', 0):
            with self.assertRaisesRegex(LabError, 'DEPTH'): self.inspect()

    def test_frontend_symlink_is_rejected(self):
        self.jar({'Product.class': b'normal'})
        (self.root / 'frontend/dist/alias.html').symlink_to('index.html')
        with self.assertRaisesRegex(LabError, 'SYMLINK'): self.inspect()


if __name__ == '__main__': unittest.main()
