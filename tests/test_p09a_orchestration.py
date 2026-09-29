"""External CLI component tests. No mocked Compose call qualifies as a live fault."""
from __future__ import annotations
import base64
import copy
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lab-support/p09a'))
import cli
from core import LabError, validate_result
from test_p09a import evidence


def environment():
    value = {key: 'b' * 64 for key in cli.REQUIRED}
    value.update(LEDGER_LAB_INSTANCE='a' * 32, LEDGER_LAB_DATABASE='ledgerguard_lab_' + 'a' * 12,
                 LEDGER_LAB_SOURCE='c' * 40, LEDGER_LAB_SOURCE_DIRTY='false', LEDGER_LAB_PORT='8090',
                 LEDGER_AUTH_KEY=base64.b64encode(b'a' * 64).decode())
    return value


class ComposeIsolationTests(unittest.TestCase):
    def test_private_project_overrides_parent_environment(self):
        values = environment()
        with patch.dict(os.environ, {'COMPOSE_PROJECT_NAME': 'ledgerguard'}), \
             patch.object(cli, 'load_environment', return_value=values), patch.object(cli, 'execute') as execute:
            cli.compose('down')
        command = execute.call_args.args[0]
        project = command[command.index('--project-name') + 1]
        self.assertEqual(project, 'ledgerguard-p09a-' + values['LEDGER_LAB_INSTANCE'])
        self.assertEqual(execute.call_args.kwargs['environment_values']['COMPOSE_PROJECT_NAME'], project)

    def test_private_values_override_parent_interpolation(self):
        values = environment()
        with patch.dict(os.environ, {'LEDGER_LAB_DATABASE': 'ordinary_database',
                                     'LEDGER_RUNTIME_PASSWORD': 'wrong-password'}), \
             patch.object(cli, 'load_environment', return_value=values), patch.object(cli, 'execute') as execute:
            cli.compose('up')
        child = execute.call_args.kwargs['environment_values']
        self.assertEqual(child['LEDGER_LAB_DATABASE'], values['LEDGER_LAB_DATABASE'])
        self.assertEqual(child['LEDGER_RUNTIME_PASSWORD'], values['LEDGER_RUNTIME_PASSWORD'])

    def test_arbitrary_compose_overlay_rejected(self):
        with patch.object(cli, 'load_environment', return_value=environment()), patch.object(cli, 'execute') as execute:
            with self.assertRaisesRegex(LabError, 'OVERLAY_NOT_ALLOWLISTED'):
                cli.compose('up', overlay=ROOT / 'compose.yaml')
            execute.assert_not_called()

    def test_lifecycle_overlay_is_exact_allowlist(self):
        with patch.object(cli, 'load_environment', return_value=environment()), patch.object(cli, 'execute') as execute:
            cli.compose('up', overlay=cli.STATE / 'lifecycle-overlay.json')
        self.assertIn(str(cli.STATE / 'lifecycle-overlay.json'), execute.call_args.args[0])

    def test_database_identity_must_match_instance(self):
        values = environment(); values['LEDGER_LAB_DATABASE'] = 'ledgerguard'
        with self.assertRaises(LabError): cli.validate_environment(values)

    def test_injected_unknown_environment_key_rejected(self):
        values = environment(); values['COMPOSE_FILE'] = '/tmp/other.yaml'
        with self.assertRaises(LabError): cli.validate_environment(values)


class TeardownTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = Path(self.directory.name) / 'runtime.env'; self.env.write_text('test fixture')
        self.env_patch = patch.object(cli, 'ENV_FILE', self.env); self.env_patch.start()
        self.ready_patch = patch.object(cli, 'docker_ready'); self.ready_patch.start()

    def tearDown(self):
        self.ready_patch.stop(); self.env_patch.stop(); self.directory.cleanup()

    def test_repeated_teardown_does_not_start_guardian_or_fail(self):
        with patch.object(cli, 'compose', return_value=subprocess.CompletedProcess([], 0, '', '')) as compose:
            cli.down()
        calls = [c.args for c in compose.call_args_list]
        self.assertEqual(calls, [('ps', '--all', '--quiet'), ('down', '--remove-orphans')])

    def test_cleanup_readback_failure_still_removes_scoped_services(self):
        def response(*args, **kwargs):
            if args[0] == 'ps': return subprocess.CompletedProcess([], 0, 'container-id', '')
            if args[0] == 'run': raise LabError('RESTORATION_FAILED')
            return subprocess.CompletedProcess([], 0, '', '')
        with patch.object(cli, 'compose', side_effect=response) as compose:
            with self.assertRaisesRegex(LabError, 'RESTORATION_FAILED'): cli.down()
        self.assertEqual(compose.call_args.args, ('down', '--remove-orphans'))
        self.assertTrue(self.env.exists())  # Normal teardown is not a destructive reset.

    def test_successful_teardown_reads_back_before_stopping_guardian(self):
        with patch.object(cli, 'compose', return_value=subprocess.CompletedProcess([], 0, 'container-id', '')) as compose:
            cli.down()
        calls = [c.args for c in compose.call_args_list]
        self.assertEqual(calls[1], ('stop', 'controller'))
        self.assertEqual(calls[2], ('run', '--rm', '--no-deps', 'guardian', 'python', 'check_restored.py'))
        self.assertEqual(calls[3], ('down', '--remove-orphans'))


class ReceiptAndEvidenceTests(unittest.TestCase):
    def test_pending_command_is_private_and_fully_written(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pending-command.json'
            cli.save_pending(path, {'requestId': 'original-intent'})
            self.assertEqual(path.read_text(), '{"requestId":"original-intent"}')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_failed_publish_preserves_previous_command(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pending-command.json'; path.write_text('original')
            with patch.object(cli.os, 'replace', side_effect=OSError('disk error')):
                with self.assertRaises(OSError): cli.save_pending(path, {'requestId': 'replacement'})
            self.assertEqual(path.read_text(), 'original')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_concurrent_cli_execution_rejected(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory, patch.object(cli, 'STATE', Path(directory)), \
             patch.object(cli, 'experiment_locked') as execute:
            with (Path(directory) / 'experiment.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(LabError, 'CLI_EXPERIMENT_ALREADY_RUNNING'):
                    cli.experiment('D02', environment())
            execute.assert_not_called()

    def test_lifecycle_checkpoint_cannot_qualify_as_defect_evidence(self):
        value = evidence(); value['testCheckpointHoldMs'] = 2000
        with self.assertRaisesRegex(LabError, 'TEST_CHECKPOINT_NOT_QUALIFIED'): validate_result(value)

    def test_unchanged_mutation_hash_rejected(self):
        value = evidence()
        value['activation']['mutantFunctionSha256'] = value['cleanup']['originalFunctionSha256']
        value['activation']['currentFunctionSha256'] = value['cleanup']['originalFunctionSha256']
        with self.assertRaisesRegex(LabError, 'ACTIVATION_MISSING'): validate_result(value)

    def test_restoration_function_hash_mismatch_rejected(self):
        value = evidence(); value['cleanup']['currentFunctionSha256'] = 'd' * 64
        with self.assertRaisesRegex(LabError, 'RESTORATION_INVALID'): validate_result(value)

    def test_readback_proves_proxy_reenabled(self):
        value = evidence(); value['cleanup']['proxyEnabled'] = False
        with self.assertRaisesRegex(LabError, 'RESTORATION_INVALID'): validate_result(value)


if __name__ == '__main__': unittest.main()
