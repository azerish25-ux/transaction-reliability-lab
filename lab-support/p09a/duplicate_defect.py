"""D06 protected disposable SQL mutation, actual broker delivery, unchanged oracle.

Each phase provisions a fresh payment under a phase-local idempotency namespace
with the identical economic intent/seed. Mutant money is deliberately retained as
synthetic evidence, never repaired or attributed to the corrected product.
"""
import os
import random
import re
from clients import Api, SOURCE, DESTINATION
from broker_experiment import Broker, VHOST, EXCHANGE
from core import LabError, canonical, digest, require, run_case, timestamp, valid_uuid


def classify_d06(phases, cleanup):
    if phases.get('baseline', {}).get('status') != 'PASS': return 'BASELINE_FAILED'
    if not cleanup.get('restored') or phases.get('restored', {}).get('status') != 'PASS': return 'CLEANUP_FAILED'
    mutant = phases.get('mutant', {})
    if mutant.get('status') == 'PASS': return 'SURVIVED'
    assertion, observations = mutant.get('assertion', {}), mutant.get('observations', {})
    if (mutant.get('status') == 'ASSERTION_FAILURE'
            and assertion.get('id') == 'D06_DUPLICATE_FINANCIAL_EFFECT'
            and assertion.get('expected') == '0'
            and isinstance(assertion.get('actual'), str) and re.fullmatch('[1-9][0-9]*', assertion['actual'])
            and assertion['actual'] == observations.get('duplicateSourceDeltaMinor')
            and observations.get('duplicateDestinationDeltaMinor') == assertion['actual']
            and observations.get('duplicateJournalDelta') == 2
            and len({p.get('inputSha256') for p in phases.values()}) == 1):
        return 'DETECTED'
    return 'INVALID_EXPERIMENT'


def execute_d06(runner, run):
    run_id, check = run['id'], lambda: runner.store.check_run(run['id'])
    amount = str(random.Random(run['seed']).randint(20, 40))
    intent = {'sourceId': SOURCE, 'recipientRef': 'LG-' + DESTINATION.replace('-', ''),
              'amountMinor': amount, 'currency': 'CAD'}
    inputs = {'seed': run['seed'], 'key': 'p09a:' + run_id, 'original': intent,
              'changed': {'duplicateDeliveries': 2, 'fixtureIsolation': 'fresh-payment-per-phase'}}
    input_hash = digest(canonical(inputs).encode())
    result = {**runner.result_identity(run), 'scope': 'REAL_HTTP_POSTGRES_RABBITMQ',
              'startedAt': timestamp(), 'input': inputs, 'phases': {}, 'cleanup': {'restored': False},
              'verdict': 'INVALID_EXPERIMENT',
              'financialCleanup': 'Mutant synthetic postings remain in the disposable database; only code is restored.'}
    phases, api, broker = result['phases'], Api('control-api'), Broker()

    def phase(observations, name):
        check()
        key = inputs['key'] + ':' + name
        response = api.call('POST', '/api/v1/payments', intent, key)
        require(response.status == 202, 'D06_PAYMENT_ACCEPTED', 202, response.status)
        operation = valid_uuid(response.json()['id'])
        with runner.oracle.connection() as conn:
            row = conn.execute("SELECT id::text,aggregate_version,correlation_id::text,occurred_at,payload "
                               "FROM ledger.outbox_events WHERE aggregate_id=%s AND event_type='payment.requested'",
                               (operation,)).fetchone()
        if row is None: raise LabError('D06_PERSISTED_EVENT_MISSING')
        event = {'eventId': row[0], 'eventType': 'payment.requested', 'schemaVersion': 1,
                 'aggregateId': operation, 'aggregateVersion': row[1], 'correlationId': row[2],
                 'occurredAt': row[3].isoformat(), 'payload': row[4]}
        start = broker.acknowledgements()
        payload_hash = broker.publish(event)
        broker.wait_ack(start + 1, check)
        before = runner.oracle.snapshot()
        before_ack = broker.acknowledgements()
        publications = []
        for _ in range(2):
            check(); publications.append(broker.publish(event))
        after_ack = broker.wait_ack(before_ack + 2, check)
        after = runner.oracle.snapshot()
        def balance(snapshot, account):
            return int(next(row[1] for row in snapshot['balances'] if row[0] == account))
        source_delta = balance(before, SOURCE) - balance(after, SOURCE)
        destination_delta = balance(after, DESTINATION) - balance(before, DESTINATION)
        observations.update(commandKey=key, operationId=operation, eventId=event['eventId'],
                            eventSha256=payload_hash, publicationHashes=publications,
                            acknowledgementsBefore=before_ack, acknowledgementsAfter=after_ack,
                            duplicateSourceDeltaMinor=str(source_delta), duplicateDestinationDeltaMinor=str(destination_delta),
                            duplicateJournalDelta=after['counts'][1] - before['counts'][1],
                            before=before, after=after)
        with runner.oracle.connection() as conn:
            state, journals = conn.execute("SELECT p.state,(SELECT count(*) FROM ledger.journals j WHERE j.operation_id=p.id) "
                                            "FROM ledger.payments p WHERE p.id=%s", (operation,)).fetchone()
        observations.update(state=state, originalOperationJournals=journals)
        require(state == 'SETTLED' and journals == 1, 'D06_ORIGINAL_SETTLEMENT_EXISTS', 'SETTLED with one original journal', [state, journals])
        # Exactly the same independent financial assertion in all three phases.
        require(source_delta == 0 and destination_delta == 0,
                'D06_DUPLICATE_FINANCIAL_EFFECT', '0', str(source_delta))
        require(after['sha256'] == before['sha256'], 'D06_GLOBAL_REPLAY_UNCHANGED', before['sha256'], after['sha256'])

    try:
        check(); api = runner.fixture_api()
        phases['baseline'] = run_case('D06_SAME_OPERATION_ONE_EFFECT', lambda o: phase(o, 'baseline'), input_hash)
        if phases['baseline']['status'] == 'PASS':
            result['activation'] = runner.activate(run_id, 'D06')
            phases['mutant'] = run_case('D06_SAME_OPERATION_ONE_EFFECT', lambda o: phase(o, 'mutant'), input_hash)
    except Exception as error:
        result['executionError'] = {'type': type(error).__name__}
        if isinstance(error, LabError): result['executionError']['code'] = error.code
    finally:
        try:
            result['cleanup'] = runner.restore(run_id)
            if phases.get('baseline', {}).get('status') == 'PASS':
                phases['restored'] = run_case('D06_SAME_OPERATION_ONE_EFFECT', lambda o: phase(o, 'restored'), input_hash)
        except Exception as error:
            result['cleanup'] = {'restored': False, 'errorType': type(error).__name__}
        result['verdict'] = classify_d06(phases, result['cleanup'])
        if runner.store.get(run_id)['cancelled']:
            result['verdict'] = 'CANCELLED' if result['cleanup'].get('restored') else 'CLEANUP_FAILED'
        result['finishedAt'] = timestamp(); runner.store.finish(run_id, result)
    return result


def validate_d06(result):
    phases, cleanup, activation = result.get('phases', {}), result.get('cleanup', {}), result.get('activation', {})
    if (result.get('scope') != 'REAL_HTTP_POSTGRES_RABBITMQ' or result.get('verdict') != 'DETECTED'
            or set(phases) != {'baseline', 'mutant', 'restored'} or classify_d06(phases, cleanup) != 'DETECTED'):
        raise LabError('EVIDENCE_D06_NOT_DETECTED')
    original, mutant = activation.get('settlementOriginalSha256'), activation.get('settlementMutantSha256')
    if (activation.get('mode') != 'D06' or not isinstance(original, str) or not re.fullmatch('[a-f0-9]{64}', original)
            or not isinstance(mutant, str) or not re.fullmatch('[a-f0-9]{64}', mutant) or original == mutant
            or activation.get('settlementCurrentSha256') != mutant
            or cleanup.get('settlementOriginalSha256') != original or cleanup.get('settlementCurrentSha256') != original):
        raise LabError('EVIDENCE_D06_ACTIVATION_OR_RESTORATION_INVALID')
    identities = set()
    amount = int(result['input']['original']['amountMinor'])
    for name, entry in phases.items():
        observation = entry.get('observations', {})
        valid_uuid(observation.get('operationId')); valid_uuid(observation.get('eventId'))
        identities.add(observation['operationId'])
        payload_hash = observation.get('eventSha256')
        before_ack, after_ack = observation.get('acknowledgementsBefore'), observation.get('acknowledgementsAfter')
        if (entry.get('testId') != 'D06_SAME_OPERATION_ONE_EFFECT'
                or observation.get('commandKey') != result['input']['key'] + ':' + name
                or not isinstance(payload_hash, str) or not re.fullmatch('[a-f0-9]{64}', payload_hash)
                or observation.get('publicationHashes') != [payload_hash, payload_hash]
                or type(before_ack) is not int or type(after_ack) is not int or before_ack < 0 or after_ack < before_ack + 2
                or observation.get('state') != 'SETTLED' or observation.get('originalOperationJournals') != 1):
            raise LabError('EVIDENCE_D06_BROKER_PROOF_INVALID')
        expected_delta = str(amount * 2) if name == 'mutant' else '0'
        if (observation.get('duplicateSourceDeltaMinor') != expected_delta
                or observation.get('duplicateDestinationDeltaMinor') != expected_delta
                or observation.get('duplicateJournalDelta') != (2 if name == 'mutant' else 0)):
            raise LabError('EVIDENCE_D06_EFFECT_INVALID')
        before, after = observation.get('before', {}), observation.get('after', {})
        for snapshot in (before, after):
            if snapshot.get('balanceDiscrepancies') != 0 or snapshot.get('journalDiscrepancies') != 0:
                raise LabError('EVIDENCE_D06_ACCOUNTING_INVALID')
            recorded = snapshot.get('sha256')
            if not isinstance(recorded, str) or recorded != digest(canonical({k: v for k, v in snapshot.items() if k != 'sha256'}).encode()):
                raise LabError('EVIDENCE_D06_SNAPSHOT_HASH_INVALID')
        try:
            before_balances = {row[0]: int(row[1]) for row in before['balances']}
            after_balances = {row[0]: int(row[1]) for row in after['balances']}
            if (set(before_balances) != set(after_balances)
                    or str(before_balances[SOURCE] - after_balances[SOURCE]) != expected_delta
                    or str(after_balances[DESTINATION] - before_balances[DESTINATION]) != expected_delta
                    or after['counts'][1] - before['counts'][1] != observation['duplicateJournalDelta']
                    or any(before_balances[k] != after_balances[k] for k in before_balances if k not in {SOURCE, DESTINATION})):
                raise LabError('EVIDENCE_D06_INDEPENDENT_DELTA_INVALID')
        except (KeyError, TypeError, ValueError, IndexError) as error:
            raise LabError('EVIDENCE_D06_SNAPSHOT_INVALID') from error
        if (before.get('sha256') == after.get('sha256')) != (name != 'mutant'):
            raise LabError('EVIDENCE_D06_SNAPSHOT_INVALID')
    if len(identities) != 3:
        raise LabError('EVIDENCE_D06_PHASE_FIXTURES_NOT_ISOLATED')
