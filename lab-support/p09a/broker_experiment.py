"""F02: actual broker duplicates with acknowledged-delivery and independent SQL oracles.

There is no arbitrary publish interface: host, vhost, exchange, routing key and
persisted event are fixed by the disposable experiment. Credentials stay private.
"""
from __future__ import annotations
import base64
import http.client
import json
import os
import random
import re
import time
from urllib.parse import quote

from clients import Api, SOURCE, DESTINATION
from core import LabError, canonical, digest, require, run_case, timestamp, valid_uuid

QUEUE = 'ledgerguard.payment-settler.v1'
EXCHANGE = 'ledgerguard.events.v1'
VHOST = '/p09a'


class Broker:
    def call(self, method, path, payload=None):
        allowed = {'/api/queues/' + quote(VHOST, safe='') + '/' + QUEUE,
                   '/api/exchanges/' + quote(VHOST, safe='') + '/' + EXCHANGE + '/publish'}
        if path not in allowed or method not in {'GET', 'POST'}:
            raise LabError('BROKER_TARGET_NOT_ALLOWLISTED')
        auth = base64.b64encode(('lab:' + os.environ['LEDGER_LAB_BROKER_PASSWORD']).encode()).decode()
        connection = http.client.HTTPConnection('rabbitmq', 15672, timeout=5)
        try:
            connection.request(method, path, body=canonical(payload) if payload is not None else None,
                               headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw = response.read(1024 * 1024 + 1)
            if response.status != 200 or len(raw) > 1024 * 1024:
                raise LabError('BROKER_CONTROL_FAILED')
            return json.loads(raw)
        finally:
            connection.close()

    def acknowledgements(self):
        value = self.call('GET', '/api/queues/' + quote(VHOST, safe='') + '/' + QUEUE)
        if value.get('name') != QUEUE or value.get('vhost') != VHOST:
            raise LabError('BROKER_QUEUE_IDENTITY_MISMATCH')
        count = value.get('message_stats', {}).get('ack', 0)
        if type(count) is not int or count < 0:
            raise LabError('BROKER_ACK_METRIC_INVALID')
        return count

    def publish(self, event):
        valid_uuid(event['eventId']); valid_uuid(event['aggregateId'])
        if event['eventType'] != 'payment.requested':
            raise LabError('BROKER_EVENT_NOT_ALLOWLISTED')
        payload = canonical(event)
        result = self.call('POST', '/api/exchanges/' + quote(VHOST, safe='') + '/' + EXCHANGE + '/publish',
                           {'properties': {'message_id': event['eventId'], 'delivery_mode': 2,
                                           'content_type': 'application/json'},
                            'routing_key': 'payment.requested', 'payload': payload, 'payload_encoding': 'string'})
        if result != {'routed': True}:
            raise LabError('BROKER_PUBLICATION_NOT_ROUTED')
        return digest(payload.encode())

    def wait_ack(self, minimum, check):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            check()
            count = self.acknowledgements()
            if count >= minimum:
                return count
            time.sleep(.3)
        raise TimeoutError('BROKER_ACKNOWLEDGEMENT_NOT_OBSERVED')


def execute_f02(runner, run):
    run_id = run['id']
    check = lambda: runner.store.check_run(run_id)
    amount = str(random.Random(run['seed']).randint(20, 40))
    intent = {'sourceId': SOURCE, 'recipientRef': 'LG-' + DESTINATION.replace('-', ''),
              'amountMinor': amount, 'currency': 'CAD'}
    inputs = {'seed': run['seed'], 'key': 'p09a:' + run_id, 'original': intent,
              'changed': {'deliveryCount': 2, 'eventIdentity': 'same-persisted-event'}}
    input_hash = digest(canonical(inputs).encode())
    result = {**runner.result_identity(run), 'scope': 'REAL_HTTP_POSTGRES_RABBITMQ',
              'startedAt': timestamp(), 'input': inputs, 'phases': {},
              'cleanup': {'restored': False}, 'verdict': 'INVALID_EXPERIMENT'}
    phases = result['phases']
    api, broker = Api('control-api'), Broker()
    event = None
    snapshot = None
    operation = None

    def delivery(observations, count):
        nonlocal snapshot
        check()
        before = broker.acknowledgements()
        hashes = []
        for _ in range(count):
            check(); hashes.append(broker.publish(event))
        after = broker.wait_ack(before + count, check)
        observations.update(eventId=event['eventId'], operationId=operation, eventSha256=hashes[0],
                            publicationHashes=hashes, routedPublications=count,
                            acknowledgementsBefore=before, acknowledgementsAfter=after)
        with runner.oracle.connection() as conn:
            state, journal = conn.execute('SELECT state,journal_id::text FROM ledger.payments WHERE id=%s',
                                           (operation,)).fetchone()
            journals = conn.execute('SELECT count(*) FROM ledger.journals WHERE operation_id=%s',
                                    (operation,)).fetchone()[0]
            inbox = conn.execute("SELECT count(*) FROM ledger.consumer_inbox WHERE consumer='payment-settler-v1' AND event_id=%s",
                                 (event['eventId'],)).fetchone()[0]
        observations.update(state=state, journalId=journal, journalCount=journals, inboxCount=inbox)
        require(state == 'SETTLED' and journal is not None, 'F02_PAYMENT_SETTLED', 'SETTLED', state)
        require(journals == 1 and inbox == 1, 'F02_SAME_EVENT_ONE_EFFECT', '1 journal and 1 inbox', [journals, inbox])
        observations['reconciliation'] = runner.oracle.snapshot()
        current = observations['reconciliation']['sha256']
        if snapshot is None: snapshot = current
        require(current == snapshot, 'F02_DUPLICATE_PRESERVES_FINANCIAL_STATE', snapshot, current)

    try:
        check()
        api = runner.fixture_api()
        response = api.call('POST', '/api/v1/payments', intent, inputs['key'])
        require(response.status == 202, 'F02_PAYMENT_ACCEPTED', 202, response.status)
        operation = valid_uuid(response.json()['id'])
        with runner.oracle.connection() as conn:
            row = conn.execute("SELECT id::text,aggregate_version,correlation_id::text,occurred_at,payload "
                               "FROM ledger.outbox_events WHERE aggregate_id=%s AND event_type='payment.requested'",
                               (operation,)).fetchone()
        if row is None: raise LabError('F02_PERSISTED_EVENT_MISSING')
        event = {'eventId': row[0], 'eventType': 'payment.requested', 'schemaVersion': 1,
                 'aggregateId': operation, 'aggregateVersion': row[1], 'correlationId': row[2],
                 'occurredAt': row[3].isoformat(), 'payload': row[4]}
        phases['baseline'] = run_case('F02_SAME_EVENT_ONE_EFFECT', lambda o: delivery(o, 1), input_hash)
        if phases['baseline']['status'] == 'PASS':
            phases['duplicate'] = run_case('F02_SAME_EVENT_ONE_EFFECT', lambda o: delivery(o, 2), input_hash)
            result['activation'] = {'broker': 'rabbitmq', 'vhost': VHOST, 'exchange': EXCHANGE,
                                    'eventId': event['eventId'], 'operationId': operation,
                                    'eventSha256': digest(canonical(event).encode())}
    except Exception as error:
        result['executionError'] = {'type': type(error).__name__}
        if isinstance(error, LabError): result['executionError']['code'] = error.code
    finally:
        try:
            result['cleanup'] = runner.restore(run_id)
            if phases.get('baseline', {}).get('status') == 'PASS':
                phases['restored'] = run_case('F02_SAME_EVENT_ONE_EFFECT', lambda o: delivery(o, 1), input_hash)
        except Exception as error:
            result['cleanup'] = {'restored': False, 'errorType': type(error).__name__}
        result['verdict'] = ('PASSED' if result['cleanup'].get('restored')
                             and set(phases) == {'baseline', 'duplicate', 'restored'}
                             and all(p['status'] == 'PASS' for p in phases.values()) else 'FAILED')
        if runner.store.get(run_id)['cancelled']:
            result['verdict'] = 'CANCELLED' if result['cleanup'].get('restored') else 'CLEANUP_FAILED'
        result['finishedAt'] = timestamp()
        runner.store.finish(run_id, result)
    return result


def validate_f02(result):
    phases = result.get('phases', {})
    if (result.get('scope') != 'REAL_HTTP_POSTGRES_RABBITMQ' or result.get('verdict') != 'PASSED'
            or set(phases) != {'baseline', 'duplicate', 'restored'}
            or any(p.get('status') != 'PASS' for p in phases.values())):
        raise LabError('EVIDENCE_BROKER_PHASES_INCOMPLETE')
    activation = result.get('activation', {})
    if activation.get('broker') != 'rabbitmq' or activation.get('vhost') != VHOST or activation.get('exchange') != EXCHANGE:
        raise LabError('EVIDENCE_BROKER_TARGET_INVALID')
    valid_uuid(activation.get('eventId')); valid_uuid(activation.get('operationId'))
    if not isinstance(activation.get('eventSha256'), str) or not re.fullmatch('[a-f0-9]{64}', activation['eventSha256']):
        raise LabError('EVIDENCE_BROKER_PAYLOAD_HASH_INVALID')
    snapshots = set()
    for name, phase in phases.items():
        observation = phase.get('observations', {})
        count = 2 if name == 'duplicate' else 1
        before, after = observation.get('acknowledgementsBefore'), observation.get('acknowledgementsAfter')
        if (phase.get('testId') != 'F02_SAME_EVENT_ONE_EFFECT'
                or observation.get('eventId') != activation['eventId']
                or observation.get('operationId') != activation['operationId']
                or observation.get('eventSha256') != activation.get('eventSha256')
                or observation.get('publicationHashes') != [activation.get('eventSha256')] * count
                or observation.get('routedPublications') != count
                or type(before) is not int or type(after) is not int or before < 0 or after < before + count
                or observation.get('state') != 'SETTLED' or observation.get('journalCount') != 1
                or observation.get('inboxCount') != 1):
            raise LabError('EVIDENCE_BROKER_DELIVERY_INVALID')
        valid_uuid(observation.get('journalId'))
        snapshot = observation.get('reconciliation', {})
        if snapshot.get('balanceDiscrepancies') != 0 or snapshot.get('journalDiscrepancies') != 0:
            raise LabError('EVIDENCE_BROKER_ACCOUNTING_INVALID')
        if not isinstance(snapshot.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', snapshot['sha256']):
            raise LabError('EVIDENCE_BROKER_SNAPSHOT_HASH_INVALID')
        snapshots.add(snapshot.get('sha256'))
    if len(snapshots) != 1 or None in snapshots:
        raise LabError('EVIDENCE_BROKER_FINANCIAL_STATE_CHANGED')
