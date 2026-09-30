"""D01 exact-target mutation and independent financial-evidence regression tests."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from core import LabError, canonical, digest, validate_result
from duplicate_command import classify_d01
from guardian import COMMAND_ACTOR_MARKER, DUPLICATE_KEY_CUT, mutate_duplicate_command
from test_p09a_hardening import complete_evidence


class DuplicateCommandTests(unittest.TestCase):
    def original(self):
        return 'CREATE OR REPLACE FUNCTION ledger.execute_command(a uuid) RETURNS text AS $$ BEGIN\n' + COMMAND_ACTOR_MARKER + '\nEND $$'

    def test_variant_changes_only_the_key_identity(self):
        source = self.original(); mutant = mutate_duplicate_command(source)
        self.assertEqual(mutant.count(DUPLICATE_KEY_CUT), 1)
        self.assertEqual(mutant.replace(DUPLICATE_KEY_CUT, ''), source)
        self.assertIn('gen_random_uuid()', mutant)

    def test_missing_ambiguous_and_wrong_function_rejected(self):
        for source in ('arbitrary', self.original() + COMMAND_ACTOR_MARKER,
                       mutate_duplicate_command(self.original()), self.original().replace('execute_command', 'settle_event')):
            with self.subTest(source=source[:50]), self.assertRaises(LabError): mutate_duplicate_command(source)

    def test_valid_synthetic_detection_passes(self):
        validate_result(complete_evidence('D01'))

    def test_setup_failure_does_not_count(self):
        value = complete_evidence('D01'); value['phases']['mutant']['status'] = 'SETUP_ERROR'
        self.assertEqual(classify_d01(value['phases'], value['cleanup']), 'INVALID_EXPERIMENT')

    def test_survivor_cannot_count(self):
        value = complete_evidence('D01'); value['phases']['mutant']['status'] = 'PASS'
        self.assertEqual(classify_d01(value['phases'], value['cleanup']), 'SURVIVED')
        with self.assertRaises(LabError): validate_result(value)

    def test_identity_failure_without_another_journal_is_invalid(self):
        value = complete_evidence('D01'); value['phases']['mutant']['observations']['replayJournalDelta'] = 0
        self.assertEqual(classify_d01(value['phases'], value['cleanup']), 'INVALID_EXPERIMENT')

    def test_changed_identity_without_actual_balance_effect_is_rejected(self):
        value = complete_evidence('D01'); o = value['phases']['mutant']['observations']
        o['after'] = o['before'].copy()
        with self.assertRaises(LabError): validate_result(value)

    def test_wrong_mutation_hash_or_mode_rejected(self):
        for key in ('currentFunctionSha256', 'duplicateCommandMutantSha256', 'mode'):
            value = complete_evidence('D01'); value['activation'][key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(LabError): validate_result(value)

    def test_rehashed_false_economic_delta_rejected(self):
        value = complete_evidence('D01'); snapshot = value['phases']['mutant']['observations']['after']
        snapshot['balances'][0][1] = '980'
        snapshot['sha256'] = digest(canonical({k:v for k,v in snapshot.items() if k != 'sha256'}).encode())
        with self.assertRaises(LabError): validate_result(value)

    def test_failed_restoration_never_qualifies(self):
        value = complete_evidence('D01'); value['cleanup']['restored'] = False
        self.assertEqual(classify_d01(value['phases'], value['cleanup']), 'CLEANUP_FAILED')


if __name__ == '__main__': unittest.main()
