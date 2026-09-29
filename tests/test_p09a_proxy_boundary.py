"""Guardian proxy-contract regressions; no simulated result counts as live F01."""
from pathlib import Path
import json
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from core import LabError
from guardian import Driver


def snapshot(**changes):
    return {'name': 'p09a-postgres', 'listen': '[::]:15432',
            'upstream': 'postgres:5432', 'enabled': True, 'toxics': [], **changes}


class ProxyBoundaryTests(unittest.TestCase):
    def read(self, value, method='GET'):
        response = Mock(status=200)
        response.json.return_value = value
        with patch('guardian.request', return_value=response):
            return Driver.proxy(method, payload={'enabled': True} if method == 'POST' else None)

    def test_go_normalized_ipv6_wildcard_accepted(self):
        self.assertEqual(self.read(snapshot())['listen'], '[::]:15432')

    def test_ipv4_wildcard_accepted(self):
        self.assertEqual(self.read(snapshot(listen='0.0.0.0:15432'))['listen'], '0.0.0.0:15432')

    def test_disabled_proxy_identity_can_be_read_for_restoration(self):
        self.assertFalse(self.read(snapshot(enabled=False))['enabled'])

    def test_wrong_proxy_name_rejected(self):
        with self.assertRaisesRegex(LabError, 'PROXY_TARGET_CHANGED'):
            self.read(snapshot(name='ordinary-product-postgres'))

    def test_changed_upstreams_rejected_without_dns_expansion(self):
        for value in ('postgres:5433', '127.0.0.1:5432', 'postgres.evil:5432',
                      'user@postgres:5432', 'postgres:5432\n', 'POSTGRES:5432', None):
            with self.subTest(value=value), self.assertRaises(LabError):
                self.read(snapshot(upstream=value))

    def test_changed_listener_or_port_rejected(self):
        for value in ('[::]:5432', '0.0.0.0:5432', '127.0.0.1:15432',
                      '[::1]:15432', ':15432', '[::%eth0]:15432', '0.0.0.0:15432\n', None):
            with self.subTest(value=value), self.assertRaises(LabError):
                self.read(snapshot(listen=value))

    def test_missing_or_invalid_state_rejected(self):
        for key in ('name', 'listen', 'upstream', 'enabled', 'toxics'):
            value = snapshot(); del value[key]
            with self.subTest(missing=key), self.assertRaises(LabError): self.read(value)
        for value in (None, [], 'proxy', snapshot(enabled=1), snapshot(toxics=None), snapshot(toxics=['bad'])):
            with self.subTest(value=value), self.assertRaises(LabError): self.read(value)

    def test_update_response_cannot_change_target(self):
        with self.assertRaises(LabError): self.read(snapshot(upstream='other:5432'), 'POST')

    def test_reset_handles_normalized_wildcard_and_retains_readback(self):
        driver = Driver.__new__(Driver)
        driver.definition = Mock(return_value={'originalFunctionSha256': 'a' * 64,
                                               'currentFunctionSha256': 'a' * 64})
        response = Mock(status=200); response.json.side_effect = [snapshot(), snapshot()]
        with patch('guardian.request', return_value=response) as request:
            result = driver.reset()
        self.assertTrue(result['restored']); self.assertTrue(result['proxyEnabled'])
        self.assertEqual(request.call_count, 2)
        driver.definition.assert_called_once_with(False)

    def test_reset_rejects_target_change_during_readback(self):
        driver = Driver.__new__(Driver); driver.definition = Mock(return_value={})
        response = Mock(status=200)
        response.json.side_effect = [snapshot(), snapshot(upstream='other:5432')]
        with patch('guardian.request', return_value=response), self.assertRaises(LabError): driver.reset()

    def test_activation_checks_target_before_mutation(self):
        for mode in ('D02', 'F01_LATENCY', 'F01_DISCONNECT'):
            driver = Driver.__new__(Driver); driver.definition = Mock(return_value={})
            response = Mock(status=200); response.json.return_value = snapshot(upstream='other:5432')
            with self.subTest(mode=mode), patch('guardian.request', return_value=response) as request:
                with self.assertRaises(LabError): driver.activate(mode)
                self.assertEqual(request.call_count, 1)
                self.assertEqual(request.call_args.args[2], 'GET')
                driver.definition.assert_not_called()

    def test_config_retains_isolated_fixed_proxy_identity(self):
        config = json.loads((Path(__file__).resolve().parents[1] / 'lab-support/p09a/toxiproxy.json').read_text())
        self.assertEqual(config, [{'name': 'p09a-postgres', 'listen': '0.0.0.0:15432',
                           'upstream': 'postgres:5432', 'enabled': True}])


if __name__ == '__main__': unittest.main()
