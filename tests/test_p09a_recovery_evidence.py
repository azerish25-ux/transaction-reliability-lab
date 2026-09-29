"""Recovery producer/serializer/gate regression; fixtures are NOT live fault proof."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lab-support/p09a'))
import cli
from clients import Api
from core import LabError, Settings, Store, validate_result
from runner import Runner
import test_p09a_hardening as hardening
from test_p09a import ACTOR, CLEAN, INSTANCE, SOURCE
from evidence_integrity import EvidenceIntegrityError


class RecoveryEvidenceTests(unittest.TestCase):
    def setUp(self):
        # Compose the existing artifact fixture without inheriting its test cases.
        # Only the recovered run below comes from the real producer. Other campaign
        # entries and the guardian acknowledgement are explicitly synthetic.
        self.artifacts = hardening.ArtifactGateTests()
        self.artifacts.setUp()
        self.addCleanup(self.artifacts.tearDown)
        self.store = Store(self.artifacts.root / 'state')
        self.settings = Settings(INSTANCE, SOURCE, False, 'http://127.0.0.1:8090',
                                 self.artifacts.root / 'state')
        with patch.dict('os.environ', {'LEDGER_LAB_TEST_CHECKPOINT_MS': '0'}):
            self.runner = Runner(self.settings, self.store)
        self.assertTrue(self.store.acknowledge(0, 'NONE', copy.deepcopy(CLEAN)))
        self.store.heartbeat('worker')

    def submit(self, claim=True):
        row = self.store.submit(ACTOR, str(uuid.uuid4()), 'D02')
        return self.store.claim() if claim else row

    def acknowledge_restoration(self, generation, mode, timeout=15):
        self.assertEqual(mode, 'NONE')
        proof = copy.deepcopy(CLEAN)
        self.assertTrue(self.store.acknowledge(generation, mode, proof))
        return proof

    def recover(self, claim=True):
        row = self.submit(claim)
        with patch.object(self.runner, 'wait', side_effect=self.acknowledge_restoration):
            self.runner.recover()
        return self.store.get(row['id'])['result']

    def collect(self, result):
        # Exercise the same serializer used by lifecycle.py, including its actual
        # JUnit and manifest hashing. Do not patch or duplicate the evidence gate.
        with patch.object(cli, 'EVIDENCE', self.artifacts.base):
            cli.collect_result(result, {'LEDGER_LAB_SOURCE': SOURCE}, strict=False)
        path = self.artifacts.base / 'lifecycle.json'
        lifecycle = json.loads(path.read_text())
        lifecycle['tests'][0]['runId'] = result['runId']
        self.artifacts.write('lifecycle.json', lifecycle)

    def test_actual_recovery_through_serializer_passes_full_artifact_gate(self):
        result = self.recover()
        self.collect(result)
        self.artifacts.verify()
        self.assertEqual(result['instanceId'], INSTANCE)
        self.assertEqual(result['sourceSha'], SOURCE)
        self.assertIs(result['dirtySource'], False)
        self.assertEqual(result['seed'], 74021)
        self.assertEqual(result['schemaVersion'], 1)
        self.assertEqual(result['verdict'], 'CANCELLED')
        self.assertEqual(result['phases'], {})
        self.assertEqual(result['reason'], 'CONTROLLER_RESTART_INTERRUPTED_EXPERIMENT')

    def test_queued_interruption_also_produces_attributed_cancellation(self):
        result = self.recover(claim=False)
        self.collect(result)
        self.artifacts.verify()
        self.assertEqual(result['verdict'], 'CANCELLED')
        self.assertEqual(result['phases'], {})

    def test_missing_instance_is_rejected_even_with_fresh_manifest(self):
        result = self.recover()
        result.pop('instanceId', None)
        self.collect(result)
        with self.assertRaisesRegex(LabError, 'EVIDENCE_LIFECYCLE_VERDICT_INVALID'):
            self.artifacts.verify()

    def test_wrong_instance_is_rejected_even_with_fresh_manifest(self):
        result = self.recover()
        result['instanceId'] = 'f' * 32 if INSTANCE != 'f' * 32 else 'e' * 32
        self.collect(result)
        with self.assertRaisesRegex(LabError, 'EVIDENCE_LIFECYCLE_VERDICT_INVALID'):
            self.artifacts.verify()

    def test_dirty_recovery_is_rejected_even_with_fresh_manifest(self):
        result = self.recover()
        result['dirtySource'] = True
        self.collect(result)
        with self.assertRaisesRegex(LabError, 'EVIDENCE_LIFECYCLE_VERDICT_INVALID'):
            self.artifacts.verify()

    def test_wrong_source_is_rejected_even_with_fresh_manifest(self):
        result = self.recover()
        result['sourceSha'] = 'f' * 40 if SOURCE != 'f' * 40 else 'e' * 40
        self.collect(result)
        with self.assertRaisesRegex(LabError, 'EVIDENCE_MANIFEST_IDENTITY_MISMATCH'):
            self.artifacts.verify()

    def test_bad_restoration_is_rejected_even_with_fresh_manifest(self):
        result = self.recover()
        result['cleanup']['currentFunctionSha256'] = '0' * 64
        self.collect(result)
        with self.assertRaisesRegex(LabError, 'EVIDENCE_RESTORATION_INVALID'):
            self.artifacts.verify()

    def test_recovery_timeout_remains_cleanup_failed(self):
        row = self.submit()
        with patch.object(self.runner, 'wait', side_effect=TimeoutError):
            self.runner.recover()
        result = self.store.get(row['id'])['result']
        self.assertEqual(result['instanceId'], INSTANCE)
        self.assertEqual(result['verdict'], 'CLEANUP_FAILED')
        self.assertIs(result['cleanup']['restored'], False)
        self.collect(result)
        with self.assertRaises(LabError):
            self.artifacts.verify()

    def test_cleanup_claim_without_acknowledgement_does_not_pass(self):
        row = self.submit()
        with patch.object(self.runner, 'wait', return_value=copy.deepcopy(CLEAN)):
            self.runner.recover()
        result = self.store.get(row['id'])['result']
        self.assertEqual(result['verdict'], 'CLEANUP_FAILED')
        self.collect(result)
        with self.assertRaises(LabError):
            self.artifacts.verify()

    def test_cancellation_cannot_be_promoted_to_qualified_defect(self):
        result = self.recover()
        with self.assertRaisesRegex(LabError, 'EVIDENCE_DEFECT_NOT_DETECTED'):
            validate_result(result, SOURCE)
        result['verdict'] = 'DETECTED'
        with self.assertRaisesRegex(LabError, 'EVIDENCE_DEFECT_NOT_DETECTED'):
            validate_result(result, SOURCE)

    def test_second_restart_preserves_existing_terminal_report(self):
        result = self.recover()
        before = copy.deepcopy(self.store.get(result['runId']))
        with patch.object(self.runner, 'wait', side_effect=self.acknowledge_restoration):
            self.runner.recover()
        self.assertEqual(self.store.get(result['runId']), before)

    def test_execution_and_recovery_share_identity_fields(self):
        recovered = self.recover()
        self.store.heartbeat('worker')
        row = self.submit()
        self.store.reset(row['id'], cancel=True)
        # Cancel before execution so no real API/SQL dependency is invoked here.
        with patch.object(self.runner, 'wait', side_effect=self.acknowledge_restoration), \
             patch.object(Api, 'call', side_effect=AssertionError('Unexpected network call')) as network:
            executed = self.runner.execute(row)
        network.assert_not_called()
        for name in ('schemaVersion', 'sourceSha', 'dirtySource', 'instanceId', 'seed', 'scenario'):
            self.assertEqual(executed[name], recovered[name], name)
        self.assertEqual(executed['runId'], row['id'])
        self.assertEqual(executed['verdict'], 'CANCELLED')

    def test_recovered_junit_tampering_is_rejected_after_rehash(self):
        result = self.recover()
        self.collect(result)
        path = self.artifacts.base / result['runId'] / 'results.xml'
        xml = ET.fromstring(path.read_bytes())
        xml.find(".//property[@name='verdict']").set('value', 'DETECTED')
        path.write_bytes(ET.tostring(xml, encoding='utf-8', xml_declaration=True))
        self.artifacts.rehash(result['runId'])
        with self.assertRaises((LabError, EvidenceIntegrityError)):
            self.artifacts.verify()


if __name__ == '__main__':
    unittest.main()
