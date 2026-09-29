"""Proxy read-back contract tests; fixtures do not count as live F01 evidence."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from proxy_contract import is_lab_proxy


class ProxyContractTests(unittest.TestCase):
    def proxy(self, **changes):
        return {'name': 'p09a-postgres', 'upstream': 'postgres:5432',
                'listen': '0.0.0.0:15432', 'enabled': True, 'toxics': [], **changes}

    def test_requested_ipv4_wildcard_accepted(self):
        self.assertTrue(is_lab_proxy(self.proxy()))

    def test_actual_dual_stack_wildcard_accepted(self):
        self.assertTrue(is_lab_proxy(self.proxy(listen='[::]:15432')))

    def test_disabled_proxy_remains_allowlisted_for_recovery(self):
        self.assertTrue(is_lab_proxy(self.proxy(enabled=False)))

    def test_toxic_state_is_not_confused_with_target_identity(self):
        self.assertTrue(is_lab_proxy(self.proxy(toxics=[{'name': 'p09a-latency'}])))

    def test_other_ports_and_listeners_rejected(self):
        for address in ('[::]:5432', '0.0.0.0:0', '0.0.0.0:15433', ':15432',
                        '127.0.0.1:15432', '10.0.0.1:15432', '[::1]:15432',
                        'toxiproxy:15432', '0.0.0.0:15432\n'):
            with self.subTest(address=address):
                self.assertFalse(is_lab_proxy(self.proxy(listen=address)))

    def test_changed_upstream_rejected(self):
        for upstream in ('other:5432', 'postgres:5433', 'postgres:5432\n', '127.0.0.1:5432'):
            with self.subTest(upstream=upstream):
                self.assertFalse(is_lab_proxy(self.proxy(upstream=upstream)))

    def test_other_proxy_name_rejected(self):
        self.assertFalse(is_lab_proxy(self.proxy(name='normal-postgres')))

    def test_malformed_or_missing_fields_rejected(self):
        for value in (None, [], {}, self.proxy(enabled=1), self.proxy(enabled='true'),
                      self.proxy(listen=[]), self.proxy(toxics=None)):
            with self.subTest(value=value):
                self.assertFalse(is_lab_proxy(value))


if __name__ == '__main__':
    unittest.main()
