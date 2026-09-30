"""D01: real HTTP replay mints a fresh economic intent only in guarded lab SQL."""
import random
import re
from clients import SOURCE, DESTINATION
from core import LabError, canonical, digest, require, run_case, timestamp, valid_uuid


def classify_d01(phases, cleanup):
    if phases.get('baseline', {}).get('status') != 'PASS': return 'BASELINE_FAILED'
    if not cleanup.get('restored') or phases.get('restored', {}).get('status') != 'PASS': return 'CLEANUP_FAILED'
    mutant = phases.get('mutant', {})
    if mutant.get('status') == 'PASS': return 'SURVIVED'
    assertion, observation = mutant.get('assertion', {}), mutant.get('observations', {})
    if (mutant.get('status') == 'ASSERTION_FAILURE'
            and assertion.get('id') == 'D01_REPLAY_ONE_OPERATION'
            and assertion.get('expected') == observation.get('originalOperation')
            and assertion.get('actual') == observation.get('replayedOperation')
            and assertion.get('expected') != assertion.get('actual')
            and observation.get('replayJournalDelta') == 1
            and len({p.get('inputSha256') for p in phases.values()}) == 1):
        return 'DETECTED'
    return 'INVALID_EXPERIMENT'


def execute_d01(runner, run):
    run_id = run['id']
    amount = str(random.Random(run['seed']).randint(20, 40))
    intent = {'sourceId': SOURCE, 'recipientRef': 'LG-' + DESTINATION.replace('-', ''),
              'amountMinor': amount, 'currency': 'CAD'}
    inputs = {'seed': run['seed'], 'key': 'p09a:' + run_id, 'original': intent,
              'changed': {'sameKeyReplays': 1, 'fixtureIsolation': 'fresh-command-per-phase'}}
    input_hash = digest(canonical(inputs).encode())
    result = {**runner.result_identity(run), 'scope': 'REAL_HTTP_POSTGRES', 'input': inputs,
              'startedAt': timestamp(), 'phases': {}, 'cleanup': {'restored': False}, 'verdict': 'INVALID_EXPERIMENT',
              'financialCleanup': 'Mutant synthetic postings retained; restoration changes code only.'}
    phases = result['phases']
    api = None

    def phase(observations, name):
        runner.store.check_run(run_id)
        key = inputs['key'] + ':' + name
        original = api.call('POST', '/api/v1/transfers', intent, key)
        require(original.status == 201, 'D01_ORIGINAL_ACCEPTED', 201, original.status)
        original_id = valid_uuid(original.json()['id'])
        before = runner.oracle.snapshot()
        runner.store.check_run(run_id)
        replay = api.call('POST', '/api/v1/transfers', intent, key)
        require(replay.status == 201, 'D01_REPLAY_ACCEPTED', 201, replay.status)
        replayed_id = valid_uuid(replay.json()['id'])
        after = runner.oracle.snapshot()
        observations.update(commandKey=key, originalOperation=original_id, replayedOperation=replayed_id,
                            originalStatus=original.status, replayStatus=replay.status,
                            before=before, after=after, replayJournalDelta=after['counts'][1]-before['counts'][1])
        require(replayed_id == original_id, 'D01_REPLAY_ONE_OPERATION', original_id, replayed_id)
        require(after['sha256'] == before['sha256'], 'D01_REPLAY_ONE_FINANCIAL_EFFECT', before['sha256'], after['sha256'])

    try:
        api = runner.fixture_api()
        phases['baseline'] = run_case('D01_SAME_KEY_ONE_EFFECT', lambda o: phase(o, 'baseline'), input_hash)
        if phases['baseline']['status'] == 'PASS':
            result['activation'] = runner.activate(run_id, 'D01')
            phases['mutant'] = run_case('D01_SAME_KEY_ONE_EFFECT', lambda o: phase(o, 'mutant'), input_hash)
    except Exception as error:
        result['executionError'] = {'type': type(error).__name__}
        if isinstance(error, LabError): result['executionError']['code'] = error.code
    finally:
        try:
            result['cleanup'] = runner.restore(run_id)
            if phases.get('baseline', {}).get('status') == 'PASS':
                phases['restored'] = run_case('D01_SAME_KEY_ONE_EFFECT', lambda o: phase(o, 'restored'), input_hash)
        except Exception as error:
            result['cleanup'] = {'restored': False, 'errorType': type(error).__name__}
        result['verdict'] = classify_d01(phases, result['cleanup'])
        if runner.store.get(run_id)['cancelled']:
            result['verdict'] = 'CANCELLED' if result['cleanup'].get('restored') else 'CLEANUP_FAILED'
        result['finishedAt'] = timestamp(); runner.store.finish(run_id, result)
    return result


def validate_d01(result):
    phases, cleanup, activation = result.get('phases', {}), result.get('cleanup', {}), result.get('activation', {})
    if (result.get('scope') != 'REAL_HTTP_POSTGRES' or result.get('verdict') != 'DETECTED'
            or set(phases) != {'baseline', 'mutant', 'restored'} or classify_d01(phases, cleanup) != 'DETECTED'):
        raise LabError('EVIDENCE_D01_NOT_DETECTED')
    variant = activation.get('duplicateCommandMutantSha256')
    if (activation.get('mode') != 'D01' or not isinstance(variant, str) or not re.fullmatch('[a-f0-9]{64}', variant)
            or activation.get('currentFunctionSha256') != variant
            or activation.get('originalFunctionSha256') != cleanup.get('originalFunctionSha256')
            or variant == cleanup.get('originalFunctionSha256')):
        raise LabError('EVIDENCE_D01_ACTIVATION_INVALID')
    amount = int(result['input']['original']['amountMinor'])
    identities = set()
    for name, entry in phases.items():
        observation = entry.get('observations', {})
        original, replayed = valid_uuid(observation.get('originalOperation')), valid_uuid(observation.get('replayedOperation'))
        identities.add(original)
        if (entry.get('testId') != 'D01_SAME_KEY_ONE_EFFECT' or observation.get('commandKey') != result['input']['key'] + ':' + name
                or observation.get('originalStatus') != 201 or observation.get('replayStatus') != 201
                or (original == replayed) != (name != 'mutant')):
            raise LabError('EVIDENCE_D01_COMMAND_INVALID')
        before, after = observation.get('before', {}), observation.get('after', {})
        for snapshot in (before, after):
            if (snapshot.get('balanceDiscrepancies') != 0 or snapshot.get('journalDiscrepancies') != 0
                    or snapshot.get('sha256') != digest(canonical({k:v for k,v in snapshot.items() if k != 'sha256'}).encode())):
                raise LabError('EVIDENCE_D01_SNAPSHOT_INVALID')
        try:
            b = {row[0]: int(row[1]) for row in before['balances']}
            a = {row[0]: int(row[1]) for row in after['balances']}
            delta = amount if name == 'mutant' else 0
            journals = 1 if name == 'mutant' else 0
            if (set(a) != set(b) or b[SOURCE] - a[SOURCE] != delta or a[DESTINATION] - b[DESTINATION] != delta
                    or after['counts'][1] - before['counts'][1] != journals or observation.get('replayJournalDelta') != journals
                    or any(a[k] != b[k] for k in a if k not in {SOURCE, DESTINATION})
                    or (before['sha256'] == after['sha256']) != (name != 'mutant')):
                raise LabError('EVIDENCE_D01_FINANCIAL_EFFECT_INVALID')
        except (KeyError, TypeError, ValueError, IndexError) as error:
            raise LabError('EVIDENCE_D01_SNAPSHOT_INVALID') from error
    if len(identities) != 3: raise LabError('EVIDENCE_D01_PHASE_FIXTURES_NOT_ISOLATED')
