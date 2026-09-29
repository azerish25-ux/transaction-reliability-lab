"""External teardown readback; never repairs state to manufacture a PASS."""
import json
import time
from core import LabError, Settings, Store
from guardian import Driver
settings = Settings.environment()
store = Store(settings.state_dir)
deadline = time.monotonic() + 25
while time.monotonic() < deadline:
    lease = store.lease()
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
        break
    time.sleep(.25)
else:
    raise LabError('TEARDOWN_RESTORATION_NOT_ACKNOWLEDGED')
