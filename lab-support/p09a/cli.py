#!/usr/bin/env python3
"""Authorized external orchestration of the single disposable P09A topology.

This CLI is not an HTTP handler. Container control never crosses the app API.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
import uuid

from clients import request
from core import LabError, canonical, catalogue, digest, junit, valid_uuid, validate_result

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.ledgerguard/p09a'
ENV_FILE = STATE / 'runtime.env'
EVIDENCE = ROOT / '.evidence/p09a'
REQUIRED = {'LEDGER_LAB_INSTANCE', 'LEDGER_LAB_DATABASE', 'LEDGER_LAB_SOURCE', 'LEDGER_LAB_SOURCE_DIRTY',
            'LEDGER_LAB_PORT', 'POSTGRES_SUPERUSER_PASSWORD', 'LEDGER_OWNER_PASSWORD', 'LEDGER_RUNTIME_PASSWORD',
            'LEDGER_AUTH_KEY', 'LEDGER_DEMO_PASSWORD', 'LEDGER_LAB_CSRF_KEY', 'LEDGER_LAB_BROKER_PASSWORD'}
SERVICES = ('postgres', 'toxiproxy', 'api', 'control-api', 'controller', 'guardian', 'rabbitmq', 'payment-worker')


def execute(command: list[str], *, capture: bool = False, timeout: int = 1200,
            check: bool = True, environment_values: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=ROOT, text=True, capture_output=capture,
                          timeout=timeout, check=check, env=environment_values)


def docker_ready() -> None:
    if shutil.which('docker') is None:
        raise LabError('DOCKER_ENGINE_AND_COMPOSE_REQUIRED', 503)
    execute(['docker', 'info'], capture=True, timeout=15)
    execute(['docker', 'compose', 'version'], capture=True, timeout=15)


def source() -> tuple[str, bool]:
    sha = execute(['git', 'rev-parse', 'HEAD'], capture=True).stdout.strip()
    dirty = bool(execute(['git', 'status', '--porcelain', '--untracked-files=all'], capture=True).stdout.strip())
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise LabError('SOURCE_COMMIT_REQUIRED')
    return sha, dirty


def load_environment() -> dict[str, str]:
    if not ENV_FILE.is_file():
        raise LabError('LAB_NOT_INITIALIZED', 409)
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in values or key not in REQUIRED:
            raise LabError('INVALID_LAB_ENVIRONMENT')
        values[key] = value
    validate_environment(values)
    return values


def validate_environment(values: dict[str, str]) -> None:
    if set(values) != REQUIRED:
        raise LabError('INCOMPLETE_LAB_ENVIRONMENT')
    instance = values['LEDGER_LAB_INSTANCE']
    if (not re.fullmatch('[a-f0-9]{32}', instance)
            or values['LEDGER_LAB_DATABASE'] != 'ledgerguard_lab_' + instance[:12]
            or not re.fullmatch('[a-f0-9]{40}', values['LEDGER_LAB_SOURCE'])
            or values['LEDGER_LAB_SOURCE_DIRTY'] not in {'true', 'false'}
            or not re.fullmatch('[0-9]{4,5}', values['LEDGER_LAB_PORT'])
            or not 1024 <= int(values['LEDGER_LAB_PORT']) <= 65535):
        raise LabError('INVALID_LAB_IDENTITY_OR_BINDING')
    for key in REQUIRED - {'LEDGER_LAB_INSTANCE', 'LEDGER_LAB_DATABASE', 'LEDGER_LAB_SOURCE',
                            'LEDGER_LAB_SOURCE_DIRTY', 'LEDGER_LAB_PORT', 'LEDGER_AUTH_KEY'}:
        if not re.fullmatch('[a-f0-9]{64}', values[key]):
            raise LabError('INVALID_GENERATED_SECRET')
    try:
        if len(base64.b64decode(values['LEDGER_AUTH_KEY'], validate=True)) != 64:
            raise ValueError('length')
    except ValueError as error:
        raise LabError('INVALID_GENERATED_AUTH_KEY') from error


def environment() -> dict[str, str]:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700); STATE.chmod(0o700)
    with (STATE / 'environment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sha, dirty = source()
        if ENV_FILE.exists():
            values = load_environment()
            if values['LEDGER_LAB_SOURCE'] != sha or values['LEDGER_LAB_SOURCE_DIRTY'] != str(dirty).lower():
                raise LabError('SOURCE_CHANGED_EXPLICIT_LAB_RESET_DATA_REQUIRED', 409)
            return values
        instance = uuid.uuid4().hex
        values = {key: secrets.token_hex(32) for key in REQUIRED}
        values.update(LEDGER_LAB_INSTANCE=instance, LEDGER_LAB_DATABASE='ledgerguard_lab_' + instance[:12],
                      LEDGER_LAB_SOURCE=sha, LEDGER_LAB_SOURCE_DIRTY=str(dirty).lower(),
                      LEDGER_LAB_PORT=os.environ.get('LEDGER_LAB_PORT', '8090'),
                      LEDGER_AUTH_KEY=base64.b64encode(secrets.token_bytes(64)).decode())
        validate_environment(values)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile('w', dir=STATE, delete=False) as output:
                temporary = Path(output.name); os.fchmod(output.fileno(), 0o600)
                output.write(''.join(f'{key}={values[key]}\n' for key in sorted(values)))
                output.flush(); os.fsync(output.fileno())
            os.replace(temporary, ENV_FILE)
        finally:
            if temporary: temporary.unlink(missing_ok=True)
        return values


def compose(*arguments: str, capture: bool = False, check: bool = True,
            timeout: int = 1200, overlay: Path | None = None) -> subprocess.CompletedProcess[str]:
    values = load_environment()  # Validate before any container operation.
    project = 'ledgerguard-p09a-' + values['LEDGER_LAB_INSTANCE']
    command = ['docker', 'compose', '--project-name', project, '--env-file', str(ENV_FILE), '-f', 'compose.lab.yaml']
    if overlay is not None:
        if overlay.resolve() != (STATE / 'lifecycle-overlay.json').resolve():
            raise LabError('COMPOSE_OVERLAY_NOT_ALLOWLISTED')
        command += ['-f', str(overlay)]
    # Shell environment has higher Compose interpolation precedence than --env-file.
    # Override every relevant value with the validated private instance configuration.
    environment_values = {**os.environ, **values, 'COMPOSE_PROJECT_NAME': project}
    return execute([*command, *arguments], capture=capture, check=check, timeout=timeout,
                   environment_values=environment_values)


class LabClient:
    def __init__(self, values: dict[str, str]):
        self.port = int(values['LEDGER_LAB_PORT'])
        self.origin = f'http://127.0.0.1:{self.port}'
        self.cookies: dict[str, str] = {}
        self.csrf = ''

    def call(self, method: str, path: str, payload: Any = None,
             extra: dict[str, str] | None = None, expected: int | None = None):
        headers = {'Host': f'127.0.0.1:{self.port}', 'Origin': self.origin,
                   'Cookie': '; '.join(k + '=' + v for k, v in self.cookies.items())}
        if payload is not None: headers['Content-Type'] = 'application/json'
        if self.csrf: headers['X-P09A-CSRF'] = self.csrf
        headers.update(extra or {})
        response = request('127.0.0.1', self.port, method, path,
                           body=None if payload is None else canonical(payload).encode(), headers=headers, timeout=15)
        for name, value in response.headers:
            if name.lower() == 'set-cookie':
                jar = SimpleCookie(); jar.load(value)
                for key, item in jar.items():
                    if key in {'P09A-SESSION', 'P09A-CSRF'}:
                        if item['max-age'] == '0': self.cookies.pop(key, None)
                        else: self.cookies[key] = item.value
        if expected is not None and response.status != expected:
            raise LabError(f'LAB_HTTP_EXPECTED_{expected}_GOT_{response.status}', 503)
        return response

    def login(self, password: str, email: str = 'admin@example.test') -> dict[str, Any]:
        token = self.call('GET', '/lab/auth/csrf', expected=200).json()
        self.call('POST', '/lab/auth/login', {'email': email, 'password': password},
                  {token['headerName']: token['token']}, expected=200)
        response = self.call('GET', '/lab/api/session', expected=200).json()
        self.csrf = response['csrf']
        return response


def up() -> dict[str, str]:
    docker_ready()
    values = environment()
    compose('config', '--quiet')
    compose('up', '-d', '--build', '--wait', 'postgres', 'toxiproxy', 'api', 'control-api')
    compose('run', '--rm', 'seed')
    compose('up', '-d', '--build', '--wait', 'rabbitmq', 'payment-worker', 'controller', 'guardian')
    client = LabClient(values)
    client.call('GET', '/healthz', expected=200)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    images = {}
    for service in SERVICES:
        container = compose('ps', '-q', service, capture=True).stdout.strip()
        if not re.fullmatch('[a-f0-9]{12,64}', container):
            raise LabError('RUNNING_CONTAINER_ID_MISSING')
        images[service] = execute(['docker', 'inspect', '--format', '{{.Image}}', container], capture=True).stdout.strip()
    (EVIDENCE / 'images.json').write_text(json.dumps({'sourceSha': values['LEDGER_LAB_SOURCE'],
         'dirtySource': values['LEDGER_LAB_SOURCE_DIRTY'] != 'false', 'instanceId': values['LEDGER_LAB_INSTANCE'],
         'composeSha256': digest((ROOT / 'compose.lab.yaml').read_bytes()), 'imageIds': images}, indent=2) + '\n')
    print(f"Lab console: {client.origin}/lab/")
    print('Lab administrator password: LEDGER_DEMO_PASSWORD in private .ledgerguard/p09a/runtime.env (not printed).')
    print('P09A controls are isolated; the normal application topology is unchanged.')
    return values


def down(reset_data: bool = False) -> None:
    if not ENV_FILE.exists(): return
    docker_ready()
    existing = compose('ps', '--all', '--quiet', capture=True).stdout.strip()
    failure = None
    try:
        if existing:
            # The guardian remains alive while the controller stops and restoration is read back.
            compose('stop', 'controller', timeout=60)
            compose('run', '--rm', '--no-deps', 'guardian', 'python', 'check_restored.py', timeout=40)
    except Exception as error:
        failure = error
    finally:
        args = ['down', '--remove-orphans']
        if reset_data: args += ['--volumes']
        # Release only this scoped topology even when the restoration proof fails.
        # A teardown action does NOT convert that failure into a passing result.
        compose(*args, timeout=180)
    if reset_data:
        ENV_FILE.unlink()
        (STATE / 'pending-command.json').unlink(missing_ok=True)
        print('Removed only the explicitly selected P09A project volumes and generated configuration.')
    if failure is not None:
        raise failure


def collect_result(value: dict[str, Any], values: dict[str, str], strict: bool = True) -> None:
    valid_uuid(value.get('runId'))
    directory = EVIDENCE / value['runId']; directory.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(value, indent=2) + '\n').encode()
    xml = junit(value)
    (directory / 'verdict.json').write_bytes(encoded)
    (directory / 'results.xml').write_bytes(xml)
    (directory / 'manifest.json').write_text(json.dumps({'sourceSha': value['sourceSha'], 'runId': value['runId'],
        'files': {'verdict.json': digest(encoded), 'results.xml': digest(xml)}}, indent=2) + '\n')
    (directory / 'README.md').write_text(f"# {value['scenario']} — {value['verdict']}\n\n"
        f"Source: `{value['sourceSha']}`. Run: `{value['runId']}`.\n\n"
        'The mutant phase may contain an expected business assertion failure. Inspect verdict.json and results.xml; '
        'an outer successful job does not change that assertion into a passing test.\n')
    if strict: validate_result(value, values['LEDGER_LAB_SOURCE'])


def save_pending(path: Path, value: dict[str, Any]) -> None:
    """Publish an original command atomically before any request can reach the server."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            os.fchmod(output.fileno(), 0o600)
            output.write(canonical(value))
            output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


def experiment(scenario: str, values: dict[str, str] | None = None) -> dict[str, Any]:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / 'experiment.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LabError('CLI_EXPERIMENT_ALREADY_RUNNING', 409) from error
        return experiment_locked(scenario, values)


def experiment_locked(scenario: str, values: dict[str, str] | None = None) -> dict[str, Any]:
    values = values or load_environment()
    sha, dirty = source()
    if sha != values['LEDGER_LAB_SOURCE'] or dirty or values['LEDGER_LAB_SOURCE_DIRTY'] != 'false':
        raise LabError('CLEAN_SOURCE_REQUIRED_FOR_VERIFIED_EXPERIMENT')
    client = LabClient(values); session = client.login(values['LEDGER_DEMO_PASSWORD'])
    if session['sourceSha'] != sha or session['instanceId'] != values['LEDGER_LAB_INSTANCE'] or session['dirtySource']:
        raise LabError('LIVE_SOURCE_IDENTITY_MISMATCH')
    command = {'requestId': str(uuid.uuid4()), 'scenario': scenario, 'seed': 74021}
    # An uncertain command response is retried with the SAME persisted request identity.
    STATE.mkdir(parents=True, exist_ok=True)
    pending_path = STATE / 'pending-command.json'
    if pending_path.exists():
        saved = json.loads(pending_path.read_text())
        if saved.get('instance') != values['LEDGER_LAB_INSTANCE']:
            raise LabError('PENDING_COMMAND_INSTANCE_MISMATCH', 409)
        previous = saved['command']
        if previous['scenario'] != scenario:
            raise LabError('RESOLVE_EXISTING_COMMAND_FIRST', 409)
        command = previous
    else:
        save_pending(pending_path, {'instance': values['LEDGER_LAB_INSTANCE'], 'command': command})
    row = client.call('POST', '/lab/api/runs', command, expected=202).json()
    # Keep the receipt until its terminal result is durably collected. A killed
    # CLI therefore resumes the original run rather than submitting a new one.
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        row = client.call('GET', '/lab/api/runs/' + row['id'], expected=200).json()
        if row['result']:
            collect_result(row['result'], values, strict=False)
            pending_path.unlink(missing_ok=True)
            validate_result(row['result'], values['LEDGER_LAB_SOURCE'])
            print(scenario, row['status'], 'run=' + row['id'])
            return row['result']
        time.sleep(0.5)
    client.call('POST', '/lab/api/runs/' + row['id'] + '/reset', {'confirm': True}, expected=202)
    raise TimeoutError('EXPERIMENT_DEADLINE_EXCEEDED')


def verify(lab_only: bool = False) -> int:
    docker_ready()
    # A complete P09A claim needs the existing product regression on this same source too.
    execute([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_p09a*.py', '-v'])
    if lab_only:
        # This component is NOT a full-product pass. CI requires the separate P08F job too.
        execute(['npm', 'ci', '--prefix', 'frontend', '--ignore-scripts', '--no-audit', '--no-fund'])
        execute(['npm', '--prefix', 'frontend', 'run', 'verify'])
        execute(['npm', 'exec', '--prefix', 'frontend', '--', 'playwright', 'install', '--with-deps', 'chromium'])
        execute(['./mvnw', '-B', '-ntp', '-f', 'backend/pom.xml', '-DskipTests', 'package'])
    else:
        execute(['./scripts/lab', 'test', 'pr'], timeout=9600)
    execute([sys.executable, 'lab-support/p09a/packaging.py'])
    values = None
    try:
        values = up()
        compose('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'api', '-ec',
                'test ! -e /app/LAB_ONLY_BUILD && test ! -e /app/guardian.py && test ! -e /app/server.py')
        results = [experiment('F01', values), experiment('D02', values), experiment('F02', values), experiment('D06', values)]
        execute(['node', 'lab-support/p09a/browser.cjs'], timeout=420)
        execute([sys.executable, 'lab-support/p09a/lifecycle.py'], timeout=180)
        (EVIDENCE / 'summary.json').write_text(json.dumps({'sourceSha': values['LEDGER_LAB_SOURCE'],
            'implementedFaultsVerified': 2, 'validDefectsDetected': 2, 'requiredFaults': 8, 'requiredDefects': 24,
            'completeP09': False, 'runs': [{'id': r['runId'], 'scenario': r['scenario'], 'verdict': r['verdict']} for r in results]}, indent=2) + '\n')
        execute([sys.executable, 'scripts/assert-p09a-evidence'])
        return 0
    finally:
        # Also called when up failed part-way, so isolation does not depend on startup succeeding.
        if ENV_FILE.exists(): down()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('up'); sub.add_parser('status'); sub.add_parser('verify'); sub.add_parser('verify-lab')
    stopped = sub.add_parser('down'); stopped.add_argument('--reset-data', action='store_true')
    defect = sub.add_parser('defect'); defect.add_argument('id', choices=['D02', 'D06'])
    resilience = sub.add_parser('resilience'); resilience.add_argument('id', choices=['F01', 'F02'])
    all_defects = sub.add_parser('defects'); all_defects.add_argument('--all', required=True, action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'defects':
            print('INCOMPLETE: only D02/D06 are implemented; 22 required defects remain NOT_STARTED.', file=sys.stderr)
            return 2
        if args.command == 'up': up()
        elif args.command == 'down': down(args.reset_data)
        elif args.command == 'status':
            docker_ready(); values = load_environment(); compose('ps')
            print(canonical(LabClient(values).call('GET', '/healthz', expected=200).json()))
        elif args.command in {'verify', 'verify-lab'}: return verify(args.command == 'verify-lab')
        else: docker_ready(); experiment(args.id)
        return 0
    except (LabError, OSError, subprocess.SubprocessError, TimeoutError) as error:
        print('BLOCKED / FAILED: ' + (error.code if isinstance(error, LabError) else type(error).__name__), file=sys.stderr)
        return 2 if isinstance(error, LabError) and error.code.startswith('DOCKER_') else 1


if __name__ == '__main__': raise SystemExit(main())
