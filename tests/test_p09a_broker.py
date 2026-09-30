"""F02 component probes. Synthetic fixtures do not count as real broker evidence."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from broker_experiment import Broker, validate_f02
from core import LabError, Store, validate_result
from test_p09a_hardening import complete_evidence


class BrokerEvidenceTests(unittest.TestCase):
    def test_complete_scoped_fixture_passes(self):
        validate_result(complete_evidence('F02'))

    def test_wrong_or_missing_delivery_observations_rejected(self):
        fields = {'eventId': str(uuid.uuid4()), 'operationId': str(uuid.uuid4()),
                  'eventSha256': '0' * 64, 'publicationHashes': ['a' * 64],
                  'routedPublications': 1, 'acknowledgementsBefore': -1,
                  'acknowledgementsAfter': 11, 'journalCount': 2, 'inboxCount': 0,
                  'state': 'PENDING', 'journalId': 'not-uuid'}
        for field, wrong in fields.items():
            with self.subTest(field=field):
                value = complete_evidence('F02')
                value['phases']['duplicate']['observations'][field] = wrong
                with self.assertRaises(LabError): validate_result(value)

    def test_acknowledgements_must_be_integer_counts(self):
        for value in (True, '12', 12.0, None):
            data = complete_evidence('F02')
            data['phases']['duplicate']['observations']['acknowledgementsAfter'] = value
            with self.subTest(value=value), self.assertRaises(LabError): validate_result(data)

    def test_all_phases_must_preserve_financial_snapshot(self):
        value = complete_evidence('F02')
        value['phases']['restored']['observations']['reconciliation']['sha256'] = 'b' * 64
        with self.assertRaisesRegex(LabError, 'FINANCIAL_STATE_CHANGED'): validate_result(value)

    def test_accounting_discrepancy_rejected(self):
        for field in ('balanceDiscrepancies', 'journalDiscrepancies'):
            value = complete_evidence('F02')
            value['phases']['duplicate']['observations']['reconciliation'][field] = 1
            with self.subTest(field=field), self.assertRaises(LabError): validate_result(value)

    def test_missing_phase_and_wrong_test_identity_rejected(self):
        value = complete_evidence('F02'); value['phases'].pop('restored')
        with self.assertRaises(LabError): validate_result(value)
        value = complete_evidence('F02'); value['phases']['duplicate']['testId'] = 'UNRELATED'
        with self.assertRaises(LabError): validate_result(value)

    def test_wrong_broker_target_rejected(self):
        for key in ('broker', 'vhost', 'exchange'):
            value = complete_evidence('F02'); value['activation'][key] = 'normal-product'
            with self.subTest(key=key), self.assertRaises(LabError): validate_result(value)

    def test_missing_payload_hash_rejected(self):
        value = complete_evidence('F02'); value['activation']['eventSha256'] = None
        with self.assertRaises(LabError): validate_result(value)


class BrokerClientTests(unittest.TestCase):
    def event(self):
        return {'eventId': str(uuid.uuid4()), 'aggregateId': str(uuid.uuid4()), 'eventType': 'payment.requested'}

    def test_publication_preserves_identical_event_and_message_identity(self):
        broker = Broker(); event = self.event()
        with patch.object(broker, 'call', return_value={'routed': True}) as call:
            self.assertEqual(broker.publish(event), broker.publish(event))
        first, second = [c.args[2] for c in call.call_args_list]
        self.assertEqual(first, second)
        self.assertEqual(first['properties']['message_id'], event['eventId'])
        self.assertEqual(json.loads(first['payload']), event)

    def test_unrouted_publication_is_failure_not_a_pass(self):
        with patch.object(Broker, 'call', return_value={'routed': False}):
            with self.assertRaisesRegex(LabError, 'NOT_ROUTED'): Broker().publish(self.event())

    def test_unknown_event_type_rejected_before_network(self):
        event = self.event(); event['eventType'] = 'arbitrary'
        with patch.object(Broker, 'call') as call:
            with self.assertRaises(LabError): Broker().publish(event)
            call.assert_not_called()

    def test_arbitrary_path_rejected_before_connection(self):
        with patch('broker_experiment.http.client.HTTPConnection') as connection:
            with self.assertRaises(LabError): Broker().call('GET', '/api/users')
            connection.assert_not_called()

    def test_queue_identity_checked(self):
        with patch.object(Broker, 'call', return_value={'name': 'normal-product', 'vhost': '/p09a'}):
            with self.assertRaisesRegex(LabError, 'IDENTITY_MISMATCH'): Broker().acknowledgements()

    def test_wait_rechecks_run_cancellation(self):
        with patch.object(Broker, 'acknowledgements', return_value=0), patch('broker_experiment.time.sleep'):
            with self.assertRaisesRegex(LabError, 'CANCELLED'):
                Broker().wait_ack(2, Mock(side_effect=LabError('CANCELLED')))


if __name__ == '__main__': unittest.main()
