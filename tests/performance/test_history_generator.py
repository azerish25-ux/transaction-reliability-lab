from pathlib import Path
import runpy
import unittest

MODULE = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'scripts/generate-performance-history'))


class HistoryGeneratorTest(unittest.TestCase):
    def test_reference_minimum_is_explicit(self):
        p = MODULE['plan']()
        self.assertEqual((p['customers'], p['walletAccounts'], p['journals']), (100, 200, 100000))
        self.assertEqual(p['fundingJournals'] + p['transferJournals'], p['journals'])
        self.assertFalse(p['runtimeExecuted'])
        self.assertIsNone(p['measuredPerformance'])

    def test_smaller_or_unbounded_reference_is_rejected(self):
        for customers, journals in [(99,100000),(100,99999),(1001,100000),(100,1000001),(True,100000)]:
            with self.assertRaises(ValueError): MODULE['plan'](customers,journals)

    def test_generator_is_deterministic(self):
        self.assertEqual(MODULE['sql'](MODULE['plan']()), MODULE['sql'](MODULE['plan']()))

    def test_roles_and_fresh_database_are_guarded(self):
        s = MODULE['sql'](MODULE['plan']())
        self.assertIn("current_database() <> 'ledgerguard_performance'", s)
        self.assertIn("current_user <> 'ledger_owner'", s)
        self.assertIn('FRESH_DATABASE_REQUIRED', s)
        self.assertNotIn('TRUNCATE', s)
        self.assertNotIn('DROP TABLE', s)

    def test_money_uses_protected_paths_and_constraints(self):
        s = MODULE['sql'](MODULE['plan']())
        self.assertEqual(s.count('SELECT ledger._post('),200)
        self.assertEqual(s.count('ledger.execute_command('),100)
        self.assertNotIn('INSERT INTO ledger.journals',s)
        self.assertNotIn('INSERT INTO ledger.journal_entries',s)
        self.assertNotIn('DISABLE TRIGGER',s)
        self.assertIn('FOR i IN 99000..99799 LOOP',s)
        self.assertEqual(s.count('SET CONSTRAINTS ALL IMMEDIATE;'),101)
        self.assertIn("'amountMinor','1'",s)

    def test_unique_fixture_identities_and_no_embedded_password(self):
        ids=[MODULE['identity'](kind,i) for kind in ('user','wallet','funding') for i in range(200)]
        self.assertEqual(len(ids),len(set(ids)))
        s=MODULE['sql'](MODULE['plan']())
        self.assertIn(r'\getenv performance_password LEDGER_PERF_PASSWORD',s)
        self.assertNotIn('password123',s)


if __name__ == '__main__': unittest.main()
