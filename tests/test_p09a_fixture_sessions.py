"""Keep growing lab catalogues inside the unchanged real login-throttle budget."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from core import LabError
from runner import Runner
import lifecycle


class FixtureSessionTests(unittest.TestCase):
    def runner(self):
        runner = Runner.__new__(Runner); runner.fixture_session = None
        return runner

    def api(self):
        api = Mock(); api.cookies = {'LG-SESSION': 'synthetic-cookie'}
        api.csrf_header = 'X-CSRF-TOKEN'; api.csrf_token = 'synthetic-token'
        api.call.return_value.status = 200
        return api

    def test_many_experiments_use_one_login_and_real_session_validation(self):
        runner, cached = self.runner(), self.api()
        clones = [self.api() for _ in range(20)]
        with patch('runner.Api', side_effect=[cached, *clones]), patch.dict('os.environ', {'LEDGER_DEMO_PASSWORD': 'fixture'}):
            for _ in range(20): runner.fixture_api()
        cached.login.assert_called_once_with('alice@example.test', 'fixture')
        self.assertEqual(cached.call.call_count, 19)
        for clone in clones:
            self.assertEqual(clone.cookies, cached.cookies)
            self.assertIsNot(clone.cookies, cached.cookies)
            clone.login.assert_not_called()

    def test_explicit_expiry_allows_one_fresh_login(self):
        runner = self.runner(); runner.fixture_session = self.api()
        runner.fixture_session.call.return_value.status = 401
        refreshed, clone = self.api(), self.api()
        with patch('runner.Api', side_effect=[refreshed, clone]), patch.dict('os.environ', {'LEDGER_DEMO_PASSWORD': 'fixture'}):
            runner.fixture_api('api')
        refreshed.login.assert_called_once()
        self.assertIs(runner.fixture_session, refreshed)

    def test_dependency_denial_does_not_trigger_credential_retries(self):
        for status in (403, 429, 500, 503):
            runner = self.runner(); runner.fixture_session = self.api()
            runner.fixture_session.call.return_value.status = status
            with self.subTest(status=status), patch('runner.Api') as api:
                with self.assertRaisesRegex(LabError, 'SESSION_VALIDATION'): runner.fixture_api()
                api.assert_not_called()
                runner.fixture_session.login.assert_not_called()

    def test_cookies_are_copied_not_shared_between_target_and_control(self):
        runner = self.runner(); runner.fixture_session = self.api(); clone = self.api()
        with patch('runner.Api', return_value=clone): returned = runner.fixture_api('api')
        returned.cookies.clear()
        self.assertEqual(runner.fixture_session.cookies, {'LG-SESSION': 'synthetic-cookie'})


class LifecycleDiagnosisTests(unittest.TestCase):
    def test_premature_terminal_result_is_retained_and_fails_immediately(self):
        client = Mock(); result = {'verdict': 'BASELINE_FAILED'}
        client.call.return_value.json.return_value = {'health': {'fault': 'NONE'},
            'runs': [{'id': 'target', 'result': result}]}
        with patch('lifecycle.collect_result') as collect, patch('lifecycle.load_environment', return_value={}), patch('lifecycle.time.sleep') as sleep:
            with self.assertRaisesRegex(LabError, 'FINISHED_BEFORE_CHECKPOINT'):
                lifecycle.wait_for(client, lambda v: v['health']['fault'] == 'D02', run_id='target')
            collect.assert_called_once_with(result, {}, strict=False)
            sleep.assert_not_called()

    def test_expected_terminal_predicate_still_passes(self):
        client = Mock(); value = {'runs': [{'id': 'target', 'result': {'verdict': 'SURVIVED'}}]}
        client.call.return_value.json.return_value = value
        self.assertEqual(lifecycle.wait_for(client, lambda v: bool(v['runs'][0]['result']), run_id='target'), value)


if __name__ == '__main__': unittest.main()
