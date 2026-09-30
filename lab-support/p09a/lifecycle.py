"""Real disposable-container crash and expiry tests; these are NOT D02 detections."""
from pathlib import Path
import json
import time
import uuid
from cli import (ENV_FILE, EVIDENCE, ROOT, STATE, LabClient, collect_result,
                 compose, execute, load_environment)
from core import LabError, require


def override(hold_ms: int) -> None:
    # Fixed, bounded configuration in an ignored test overlay; never accepted from HTTP.
    if hold_ms not in {0, 2000, 21000}: raise ValueError('Unknown test checkpoint')
    overlay = STATE / 'lifecycle-overlay.json'
    overlay.write_text(json.dumps({'services': {'controller': {
        'restart': 'no', 'environment': {'LEDGER_LAB_TEST_CHECKPOINT_MS': str(hold_ms)}}}}))
    compose('up', '-d', '--no-deps', '--wait', 'controller', overlay=overlay, timeout=180)


def wait_for(client: LabClient, predicate, seconds: int = 45, run_id: str | None = None):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = client.call('GET', '/lab/api/runs', expected=200).json()
        if predicate(value): return value
        if run_id:
            finished = next((r for r in value['runs'] if r['id'] == run_id and r.get('result')), None)
            if finished:
                collect_result(finished['result'], load_environment(), strict=False)
                raise LabError('LIFECYCLE_RUN_FINISHED_BEFORE_CHECKPOINT')
        time.sleep(.1)
    raise TimeoutError('LIFECYCLE_CHECKPOINT_TIMEOUT')


def submit(client: LabClient):
    return client.call('POST', '/lab/api/runs',
                       {'requestId': str(uuid.uuid4()), 'scenario': 'D02', 'seed': 74021}, expected=202).json()


def main() -> None:
    values = load_environment()
    results = {'sourceSha': values['LEDGER_LAB_SOURCE'], 'scope': 'REAL_CONTROLLER_CRASH_AND_EXPIRY', 'tests': []}
    try:
        override(2000)
        client = LabClient(values); client.login(values['LEDGER_DEMO_PASSWORD'])
        run = submit(client)
        wait_for(client, lambda value: value['health']['fault'] == 'D02', run_id=run['id'])
        compose('kill', '-s', 'SIGKILL', 'controller')
        running = compose('ps', '--status', 'running', '-q', 'controller', capture=True).stdout.strip()
        require(not running, 'CONTROLLER_ACTUALLY_TERMINATED', '', running)
        # Controller is dead; only the independently running guardian can restore the mutant.
        readback = compose('run', '--rm', '--no-deps', 'guardian', 'python', 'check_restored.py', capture=True, timeout=40)
        require('"restored": true' in readback.stdout, 'INDEPENDENT_GUARDIAN_RESTORED', True, readback.stdout)
        override(0)
        client = LabClient(values); client.login(values['LEDGER_DEMO_PASSWORD'])
        wait_for(client, lambda value: any(r['id'] == run['id'] and r['result'] for r in value['runs']))
        recovered = client.call('GET', '/lab/api/runs/' + run['id'], expected=200).json()
        require(recovered['status'] == 'CANCELLED', 'CRASH_IS_NOT_DETECTED_DEFECT', 'CANCELLED', recovered['status'])
        collect_result(recovered['result'], values, strict=False)
        results['tests'].append({'id': 'CONTROLLER_SIGKILL_GUARDIAN_RECOVERY', 'status': 'PASS', 'runId': run['id']})

        override(21000)  # Deliberately outlast the fixed twenty-second lease, not the run deadline.
        client = LabClient(values); client.login(values['LEDGER_DEMO_PASSWORD'])
        run = submit(client)
        wait_for(client, lambda value: value['health']['fault'] == 'D02', run_id=run['id'])
        wait_for(client, lambda value: value['health']['fault'] == 'NONE', seconds=30)
        wait_for(client, lambda value: any(r['id'] == run['id'] and r['result'] for r in value['runs']), seconds=30)
        expired = client.call('GET', '/lab/api/runs/' + run['id'], expected=200).json()
        require(expired['status'] == 'SURVIVED', 'EXPIRED_VARIANT_CANNOT_COUNT_AS_DETECTED', 'SURVIVED', expired['status'])
        require(expired['result']['cleanup'].get('restored') is True, 'EXPIRY_RESTORATION_READBACK', True, False)
        collect_result(expired['result'], values, strict=False)
        results['tests'].append({'id': 'REAL_MUTANT_AUTOMATIC_EXPIRY', 'status': 'PASS', 'runId': run['id']})
    finally:
        # Remove the testing override and restore the normal lab controller configuration.
        compose('up', '-d', '--no-deps', '--wait', 'controller')
    (EVIDENCE / 'lifecycle.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__': main()
