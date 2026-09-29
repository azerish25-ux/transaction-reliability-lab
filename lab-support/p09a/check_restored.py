"""External teardown readback; never repairs state to manufacture a PASS."""
import json
import re
import time


def diagnostic(lease):
    """Only bounded state codes; never SQL, exception text, cookies or credentials."""
    code = lease.get('error')
    safe_code = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,99}', code) else 'REDACTED_OR_ABSENT'
    return {'guardianError': safe_code,
            'resetRequested': lease.get('desired') == 'NONE',
            'resetApplied': lease.get('applied') == 'NONE',
            'generationAcknowledged': type(lease.get('generation')) is int and lease.get('generation') == lease.get('applied_generation')}


def main():
    from core import LabError, Settings, Store
    from guardian import Driver
    settings = Settings.environment()
    store = Store(settings.state_dir)
    deadline = time.monotonic() + 25
    previous = None
    while time.monotonic() < deadline:
        lease = store.lease()
        snapshot = diagnostic(lease)
        if snapshot != previous:
            print(json.dumps({'teardownDiagnostic': snapshot}), flush=True)
            previous = snapshot
        if lease['desired'] == lease['applied'] == 'NONE' and lease['generation'] == lease['applied_generation'] and not lease['error']:
            driver = Driver(settings)
            observed = driver.proxy()
            with driver.oracle.connection(owner=True) as conn:
                from clients import FUNCTION
                expected = conn.execute('SELECT original_definition FROM p09a_guard.instance WHERE singleton=1').fetchone()[0]
                current = conn.execute('SELECT pg_get_functiondef(%s::regprocedure)', (FUNCTION,)).fetchone()[0]
            if current != expected or observed.get('enabled') is not True or observed.get('toxics'):
                raise LabError('TEARDOWN_READBACK_FAILED')
            print(json.dumps({'restored': True, 'instanceId': settings.instance, 'sourceSha': settings.source}))
            return
        time.sleep(.25)
    raise LabError('TEARDOWN_RESTORATION_NOT_ACKNOWLEDGED')


if __name__ == '__main__':
    main()
