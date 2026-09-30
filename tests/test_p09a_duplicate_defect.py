"""D06 mutation/verdict integrity tests; generated fixtures are not live evidence."""
from pathlib import Path
import copy
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from core import LabError, Store, canonical, digest, validate_result
from duplicate_defect import classify_d06
from guardian import SETTLEMENT_CUT, SETTLEMENT_MARKER, mutate_settlement
from test_p09a import ACTOR, CLEAN
from test_p09a_hardening import complete_evidence


class DuplicateMutationTests(unittest.TestCase):
    def original(self):
        return 'CREATE OR REPLACE FUNCTION ledger.settle_event(a uuid) RETURNS text AS $$ BEGIN ' + SETTLEMENT_MARKER + ' END $$'

    def test_exact_target_has_one_documented_protection_cut(self):
        original = self.original(); mutant = mutate_settlement(original)
        self.assertEqual(mutant.count(SETTLEMENT_CUT), 1)
        self.assertEqual(mutant.replace(SETTLEMENT_CUT, ''), original)
        self.assertIn("p.state='SETTLED'", mutant)
        self.assertIn("_post(gen_random_uuid(),'PAYMENT'", mutant)

    def test_missing_ambiguous_and_already_mutated_targets_rejected(self):
        for source in ('arbitrary sql', self.original() + SETTLEMENT_MARKER,
                       mutate_settlement(self.original()), self.original().replace('settle_event', 'execute_command')):
            with self.subTest(source=source[:50]), self.assertRaises(LabError): mutate_settlement(source)

    def test_d06_cannot_activate_d02_or_network_fault(self):
        with tempfile.TemporaryDirectory() as temp:
            store = Store(Path(temp)); store.acknowledge(0, 'NONE', CLEAN); store.heartbeat('worker')
            run = store.submit(ACTOR, str(uuid.uuid4()), 'D06'); store.claim()
            for mode in ('D02', 'F01_DISCONNECT'):
                with self.subTest(mode=mode), self.assertRaisesRegex(LabError, 'SCOPE_MISMATCH'):
                    store.request_fault(run['id'], mode)
            self.assertIsInstance(store.request_fault(run['id'], 'D06'), int)


class DuplicateEvidenceTests(unittest.TestCase):
    def test_valid_synthetic_detection_passes_strict_validator(self):
        validate_result(complete_evidence('D06'))

    def test_no_mutant_failure_is_survived(self):
        value = complete_evidence('D06'); value['phases']['mutant']['status'] = 'PASS'
        self.assertEqual(classify_d06(value['phases'], value['cleanup']), 'SURVIVED')
        with self.assertRaises(LabError): validate_result(value)

    def test_setup_error_and_unrelated_assertion_never_detected(self):
        for status in ('SETUP_ERROR', 'TIMEOUT', 'ASSERTION_FAILURE'):
            value = complete_evidence('D06'); mutant = value['phases']['mutant']
            mutant['status'] = status; mutant['assertion']['id'] = 'UNRELATED'
            self.assertEqual(classify_d06(value['phases'], value['cleanup']), 'INVALID_EXPERIMENT')

    def test_baseline_and_restoration_must_pass(self):
        for name, expected in [('baseline', 'BASELINE_FAILED'), ('restored', 'CLEANUP_FAILED')]:
            value = complete_evidence('D06'); value['phases'][name]['status'] = 'TIMEOUT'
            self.assertEqual(classify_d06(value['phases'], value['cleanup']), expected)

    def test_dirty_source_rejected(self):
        value = complete_evidence('D06'); value['dirtySource'] = True
        with self.assertRaises(LabError): validate_result(value)

    def test_activation_and_restoration_need_actual_distinct_function_hashes(self):
        for location, key in [('activation', 'mode'), ('activation', 'settlementCurrentSha256'),
                              ('activation', 'settlementMutantSha256'), ('cleanup', 'settlementCurrentSha256')]:
            value = complete_evidence('D06'); value[location][key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(LabError): validate_result(value)

    def test_broker_acknowledgement_and_identical_payload_required(self):
        for key, bad in [('acknowledgementsAfter', 2), ('publicationHashes', ['wrong', 'wrong']),
                         ('state', 'PENDING'), ('originalOperationJournals', 0)]:
            value = complete_evidence('D06'); value['phases']['mutant']['observations'][key] = bad
            with self.subTest(key=key), self.assertRaises(LabError): validate_result(value)

    def test_raw_snapshot_tampering_rejected_without_rehash(self):
        value = complete_evidence('D06'); value['phases']['mutant']['observations']['after']['counts'][1] = 99
        with self.assertRaisesRegex(LabError, 'SNAPSHOT_HASH'): validate_result(value)

    def test_rehashed_false_journal_delta_rejected(self):
        value = complete_evidence('D06'); snapshot = value['phases']['mutant']['observations']['after']
        snapshot['counts'][1] = 99
        snapshot['sha256'] = digest(canonical({k: v for k, v in snapshot.items() if k != 'sha256'}).encode())
        with self.assertRaisesRegex(LabError, 'INDEPENDENT_DELTA'): validate_result(value)

    def test_same_fixture_operation_cannot_be_reused_across_phases(self):
        value = complete_evidence('D06')
        value['phases']['restored']['observations']['operationId'] = value['phases']['baseline']['observations']['operationId']
        with self.assertRaisesRegex(LabError, 'FIXTURES_NOT_ISOLATED'): validate_result(value)

    def test_input_hash_cannot_change_to_make_mutant_fail(self):
        value = complete_evidence('D06'); value['phases']['mutant']['inputSha256'] = '0' * 64
        with self.assertRaises(LabError): validate_result(value)


if __name__ == '__main__': unittest.main()
