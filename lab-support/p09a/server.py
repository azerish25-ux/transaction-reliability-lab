"""Lab-build-only administrator console. Fixed operations, no shell or arbitrary proxy."""
from __future__ import annotations

from hashlib import sha256
import hmac
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import threading
from typing import Any
from urllib.parse import urlsplit

from clients import request
from core import LabError, Settings, Store, canonical, catalogue, junit, valid_uuid
from runner import Runner

STATIC = {'/lab/': ('index.html', 'text/html; charset=utf-8'),
          '/lab/app.js': ('app.js', 'text/javascript; charset=utf-8'),
          '/lab/style.css': ('style.css', 'text/css; charset=utf-8')}
AUTH = {'csrf': 'GET', 'login': 'POST', 'me': 'GET', 'logout': 'POST'}
COOKIE_NAMES = {'P09A-SESSION': 'LG-SESSION', 'P09A-CSRF': 'LG-CSRF'}
MAX_BODY = 16384


def cookies(header: str) -> dict[str, str]:
    jar = SimpleCookie()
    try:
        jar.load(header)
    except CookieError as error:
        raise LabError('INVALID_COOKIE', 400) from error
    return {name: item.value for name, item in jar.items() if name in COOKIE_NAMES}


def csrf_token(session: str, origin: str, key: bytes) -> str:
    if not session or len(session) > 8192:
        raise LabError('AUTHENTICATION_REQUIRED', 401)
    return hmac.new(key, (origin + '\n' + session).encode(), sha256).hexdigest()


def validate_boundary(method: str, path: str, headers: Any, origin: str) -> None:
    if headers.get('Host') != urlsplit(origin).netloc:
        raise LabError('LAB_LOOPBACK_ONLY', 403)
    if len(path) > 256 or '?' in path or '#' in path or '%' in path or '\\' in path or '..' in path:
        raise LabError('INVALID_PATH', 400)
    if headers.get('Sec-Fetch-Site') == 'cross-site':
        raise LabError('CROSS_SITE_FORBIDDEN', 403)
    if method != 'GET' and headers.get('Origin') != origin:
        raise LabError('ORIGIN_FORBIDDEN', 403)
    if headers.get('Transfer-Encoding'):
        raise LabError('CHUNKED_BODY_NOT_SUPPORTED', 400)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address: tuple[str, int], settings: Settings, store: Store, key: bytes):
        self.settings, self.store, self.csrf_key = settings, store, key
        self.capacity = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, connection: Any, address: Any) -> None:
        if not self.capacity.acquire(blocking=False):
            connection.close()
            return
        try:
            super().process_request(connection, address)
        except BaseException:
            self.capacity.release()
            raise

    def process_request_thread(self, connection: Any, address: Any) -> None:
        try:
            super().process_request_thread(connection, address)
        finally:
            self.capacity.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'LedgerGuardLab'
    sys_version = ''
    protocol_version = 'HTTP/1.0'

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_: Any) -> None:
        # Access logs must not capture authentication material or attacker input.
        pass

    def do_GET(self) -> None:
        self.dispatch()

    def do_POST(self) -> None:
        self.dispatch()

    def send(self, status: int, body: bytes, kind: str = 'application/json',
             extra: list[tuple[str, str]] | None = None) -> None:
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; "
                         "connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        for key, value in extra or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def value(self, status: int, body: Any) -> None:
        self.send(status, canonical(body).encode())

    def body(self) -> bytes:
        lengths = self.headers.get_all('Content-Length') or []
        if len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,5}', lengths[0]):
            raise LabError('CONTENT_LENGTH_REQUIRED', 411)
        size = int(lengths[0])
        if size > MAX_BODY:
            raise LabError('REQUEST_TOO_LARGE', 413)
        if self.headers.get_content_type() != 'application/json':
            raise LabError('JSON_REQUIRED', 415)
        value = self.rfile.read(size)
        if len(value) != size:
            raise LabError('INCOMPLETE_REQUEST')
        return value

    def payload(self) -> dict[str, Any]:
        try:
            value = json.loads(self.body())
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise LabError('INVALID_JSON') from error
        if not isinstance(value, dict):
            raise LabError('JSON_OBJECT_REQUIRED')
        return value

    def backend_headers(self) -> dict[str, str]:
        incoming = cookies(self.headers.get('Cookie', ''))
        headers = {'Host': '127.0.0.1:8080', 'Origin': 'http://127.0.0.1:8080',
                   'Cookie': '; '.join(COOKIE_NAMES[name] + '=' + value for name, value in incoming.items())}
        for key in ('X-CSRF-TOKEN', 'X-XSRF-TOKEN'):
            if self.headers.get(key):
                headers[key] = self.headers[key]
        return headers

    def administrator(self) -> dict[str, Any]:
        response = request('control-api', 8080, 'GET', '/api/v1/auth/me', headers=self.backend_headers(), timeout=5)
        if response.status in {401, 403}:
            raise LabError('AUTHENTICATION_REQUIRED', 401)
        if response.status != 200:
            raise LabError('AUTHORIZATION_SERVICE_UNAVAILABLE', 503)
        user = response.json()
        if not isinstance(user, dict) or user.get('role') != 'ADMIN':
            raise LabError('ADMIN_REQUIRED', 403)
        valid_uuid(user.get('id'))
        return user

    def verify_command_csrf(self) -> None:
        session = cookies(self.headers.get('Cookie', '')).get('P09A-SESSION', '')
        expected = csrf_token(session, self.server.settings.origin, self.server.csrf_key)
        actual = self.headers.get('X-P09A-CSRF', '')
        if not re.fullmatch(r'[a-f0-9]{64}', actual) or not hmac.compare_digest(actual, expected):
            raise LabError('CSRF_REQUIRED', 403)

    def auth(self, action: str) -> None:
        if AUTH.get(action) != self.command:
            raise LabError('NOT_FOUND', 404)
        headers = self.backend_headers()
        body = None
        if self.command == 'POST':
            body = self.body()
            headers['Content-Type'] = 'application/json'
        response = request('control-api', 8080, self.command, '/api/v1/auth/' + action,
                           body=body, headers=headers, timeout=6)
        mapped = []
        for name, value in response.headers:
            if name.lower() != 'set-cookie':
                continue
            jar = SimpleCookie(); jar.load(value)
            for old, item in jar.items():
                if old not in COOKIE_NAMES.values():
                    continue
                new = next(k for k, v in COOKIE_NAMES.items() if v == old)
                out = SimpleCookie(); out[new] = item.value
                out[new]['path'] = '/lab/'
                out[new]['samesite'] = 'Strict'
                if new == 'P09A-SESSION':
                    out[new]['httponly'] = True
                if item['max-age']:
                    out[new]['max-age'] = item['max-age']
                mapped.append(('Set-Cookie', out[new].OutputString()))
        self.send(response.status, response.body, extra=mapped)

    def dispatch(self) -> None:
        try:
            if len(self.headers.get_all('Host') or []) != 1:
                raise LabError('SINGLE_HOST_REQUIRED', 400)
            validate_boundary(self.command, self.path, self.headers, self.server.settings.origin)
            if self.path == '/healthz' and self.command == 'GET':
                health = self.server.store.health()
                self.value(200 if health['guardianReady'] and health['workerReady'] else 503,
                           {'ready': health['guardianReady'] and health['workerReady']})
                return
            if self.path in STATIC and self.command == 'GET':
                filename, kind = STATIC[self.path]
                self.send(200, (Path(__file__).parent / 'static' / filename).read_bytes(), kind)
                return
            if self.path.startswith('/lab/auth/'):
                self.auth(self.path.removeprefix('/lab/auth/'))
                return
            if not self.path.startswith('/lab/api/'):
                raise LabError('NOT_FOUND', 404)
            user = self.administrator()  # Live backend identity, never a role supplied by the browser.
            if self.command == 'POST':
                self.verify_command_csrf()
            if self.path == '/lab/api/session' and self.command == 'GET':
                session = cookies(self.headers.get('Cookie', '')).get('P09A-SESSION', '')
                self.value(200, {'user': user, 'csrf': csrf_token(session, self.server.settings.origin, self.server.csrf_key),
                                 'instanceId': self.server.settings.instance, 'sourceSha': self.server.settings.source,
                                 'dirtySource': self.server.settings.dirty, 'health': self.server.store.health()})
            elif self.path == '/lab/api/catalogue' and self.command == 'GET':
                self.value(200, catalogue())
            elif self.path == '/lab/api/runs' and self.command == 'GET':
                self.value(200, {'runs': self.server.store.recent(), 'health': self.server.store.health()})
            elif self.path == '/lab/api/runs' and self.command == 'POST':
                body = self.payload()
                if set(body) != {'requestId', 'scenario', 'seed'}:
                    raise LabError('INVALID_COMMAND_FIELDS')
                self.value(202, self.server.store.submit(user['id'], body['requestId'], body['scenario'], body['seed']))
            else:
                match = re.fullmatch(r'/lab/api/runs/([0-9a-f-]{36})(/reset|/junit)?', self.path)
                if not match:
                    raise LabError('NOT_FOUND', 404)
                run_id, action = match.groups()
                row = self.server.store.get(run_id)
                if action == '/reset' and self.command == 'POST':
                    if self.payload() != {'confirm': True}:
                        raise LabError('RESET_CONFIRMATION_REQUIRED')
                    if row['status'] not in {'QUEUED', 'RUNNING', 'CLEANING'}:
                        self.value(200, row)  # Terminal-run reset cannot affect a different active run.
                    else:
                        self.server.store.reset(run_id, cancel=True)
                        self.value(202, self.server.store.get(run_id))
                elif action == '/junit' and self.command == 'GET' and row['result']:
                    self.send(200, junit(row['result']), 'application/xml')
                elif action is None and self.command == 'GET':
                    self.value(200, row)
                else:
                    raise LabError('NOT_FOUND', 404)
        except LabError as error:
            self.value(error.status, {'code': error.code})
        except (TimeoutError, ConnectionError, OSError):
            self.value(503, {'code': 'LAB_DEPENDENCY_UNAVAILABLE'})
        except Exception:
            self.value(500, {'code': 'LAB_INTERNAL_ERROR'})


def main() -> int:
    settings = Settings.environment()
    key = os.environ.get('LEDGER_LAB_CSRF_KEY', '')
    if not re.fullmatch(r'[a-f0-9]{64}', key):
        raise LabError('LAB_CSRF_KEY_REQUIRED', 503)
    store = Store(settings.state_dir)
    stop = threading.Event()
    runner = Runner(settings, store)
    worker = threading.Thread(target=runner.loop, args=(stop,), name='p09a-experiments', daemon=True)
    worker.start()

    def heartbeat() -> None:
        while not stop.wait(1):
            if worker.is_alive():
                store.heartbeat('worker')

    threading.Thread(target=heartbeat, name='p09a-liveness', daemon=True).start()
    server = Server(('0.0.0.0', 8090), settings, store, bytes.fromhex(key))

    def shutdown(*_: Any) -> None:
        stop.set()
        store.reset(cancel=False)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        stop.set()
        server.server_close()
        generation = store.reset()
        try:
            runner.wait(generation, 'NONE', 15)
        except Exception:
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
