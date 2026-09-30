"""Actual console HTTP server with an explicitly substituted authentication backend.

These security/interface component tests are NOT full-stack financial evidence.
"""
from __future__ import annotations
from dataclasses import replace
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lab-support/p09a'))
from clients import Response
from core import Settings, Store, canonical
from server import Server, csrf_token

ADMIN = '00000000-0000-0000-0000-000000000004'
CUSTOMER = '00000000-0000-0000-0000-000000000001'
KEY = b'c' * 32


class ConsoleHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name))
        self.store.acknowledge(0, 'NONE', {'restored': True})
        self.store.heartbeat('guardian'); self.store.heartbeat('worker')
        self.settings = Settings('a' * 32, 'b' * 40, True, 'http://127.0.0.1:8090', Path(self.temp.name))
        self.server = Server(('127.0.0.1', 0), self.settings, self.store, KEY)
        self.port = self.server.server_address[1]
        self.origin = f'http://127.0.0.1:{self.port}'
        self.server.settings = replace(self.settings, origin=self.origin)
        self.calls = []
        self.mock = patch('server.request', side_effect=self.backend); self.mock.start()
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.mock.stop(); self.temp.cleanup()

    def backend(self, host, port, method, path, *, headers=None, body=None, **_):
        self.calls.append({'host': host, 'port': port, 'method': method, 'path': path, 'headers': headers, 'body': body})
        cookie = (headers or {}).get('Cookie', '')
        if path == '/api/v1/auth/me':
            if 'LG-SESSION=admin-component' in cookie:
                value = {'id': ADMIN, 'email': 'admin@example.test', 'role': 'ADMIN'}; status = 200
            elif 'LG-SESSION=customer-component' in cookie:
                value = {'id': CUSTOMER, 'email': 'alice@example.test', 'role': 'CUSTOMER'}; status = 200
            else:
                value = {'code': 'UNAUTHORIZED'}; status = 401
            return Response(status, canonical(value).encode(), [])
        if path == '/api/v1/auth/csrf':
            return Response(200, canonical({'headerName': 'X-XSRF-TOKEN', 'token': 'component-csrf'}).encode(),
                            [('Set-Cookie', 'LG-CSRF=component-csrf; Path=/; SameSite=Strict')])
        if path == '/api/v1/auth/login':
            if headers.get('X-XSRF-TOKEN') != 'component-csrf':
                return Response(403, b'{"code":"CSRF_REQUIRED"}', [])
            return Response(200, canonical({'id': ADMIN, 'role': 'ADMIN'}).encode(),
                            [('Set-Cookie', 'LG-SESSION=admin-component; Max-Age=900; Path=/; HttpOnly; SameSite=Strict')])
        if path == '/api/v1/auth/logout':
            return Response(204, b'', [('Set-Cookie', 'LG-SESSION=; Max-Age=0; Path=/')])
        raise AssertionError('Proxy expanded beyond the fixed authentication allowlist')

    def request(self, method='GET', path='/lab/api/catalogue', data=None, session='admin-component',
                signed=False, headers=None, body=None):
        values = {'Host': f'127.0.0.1:{self.port}', 'Origin': self.origin}
        if session is not None: values['Cookie'] = 'P09A-SESSION=' + session
        if signed: values['X-P09A-CSRF'] = csrf_token(session, self.origin, KEY)
        if data is not None:
            body = canonical(data).encode(); values['Content-Type'] = 'application/json'
        values.update(headers or {})
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        connection.request(method, path, body=body, headers=values)
        response = connection.getresponse(); content = response.read()
        result = response.status, content, response.getheaders(); connection.close(); return result

    def command(self): return {'requestId': str(uuid.uuid4()), 'scenario': 'D02', 'seed': 74021}

    def test_unauthenticated_catalogue_denied(self):
        self.assertEqual(self.request(session=None)[0], 401)

    def test_authenticated_customer_denied(self):
        self.assertEqual(self.request(session='customer-component')[0], 403)

    def test_admin_catalogue_available(self):
        status, content, _ = self.request()
        self.assertEqual(status, 200); self.assertEqual(set(json.loads(content)['implemented']), {'F01', 'D02', 'F02'})

    def test_command_missing_csrf_denied(self):
        self.assertEqual(self.request('POST', '/lab/api/runs', self.command())[0], 403)
        self.assertEqual(len(self.store.recent()), 0)

    def test_command_correct_csrf_accepted(self):
        status, content, _ = self.request('POST', '/lab/api/runs', self.command(), signed=True)
        self.assertEqual(status, 202); self.assertEqual(json.loads(content)['status'], 'QUEUED')

    def test_http_replay_same_request_id(self):
        command = self.command()
        one = json.loads(self.request('POST', '/lab/api/runs', command, signed=True)[1])
        two = json.loads(self.request('POST', '/lab/api/runs', command, signed=True)[1])
        self.assertEqual(one['id'], two['id'])

    def test_actor_cannot_be_overridden_in_json(self):
        command = {**self.command(), 'actor': CUSTOMER}
        self.assertEqual(self.request('POST', '/lab/api/runs', command, signed=True)[0], 400)

    def test_json_unknown_target_rejected(self):
        command = {**self.command(), 'url': 'http://example.test'}
        self.assertEqual(self.request('POST', '/lab/api/runs', command, signed=True)[0], 400)

    def test_cross_origin_command_denied_before_backend(self):
        status = self.request('POST', '/lab/api/runs', self.command(), signed=True,
                              headers={'Origin': 'https://evil.example'})[0]
        self.assertEqual(status, 403); self.assertEqual(self.calls, [])

    def test_csrf_from_other_session_denied(self):
        status = self.request('POST', '/lab/api/runs', self.command(),
                              headers={'X-P09A-CSRF': csrf_token('different-session', self.origin, KEY)})[0]
        self.assertEqual(status, 403)

    def test_unimplemented_scenario_http_rejected(self):
        command = {**self.command(), 'scenario': 'D01'}
        self.assertEqual(self.request('POST', '/lab/api/runs', command, signed=True)[0], 422)

    def test_reset_requires_confirmation(self):
        row = self.store.submit(ADMIN, str(uuid.uuid4()), 'D02')
        self.assertEqual(self.request('POST', '/lab/api/runs/' + row['id'] + '/reset', {}, signed=True)[0], 400)
        self.assertFalse(self.store.get(row['id'])['cancelled'])

    def test_reset_sets_cancellation(self):
        row = self.store.submit(ADMIN, str(uuid.uuid4()), 'D02')
        self.assertEqual(self.request('POST', '/lab/api/runs/' + row['id'] + '/reset', {'confirm': True}, signed=True)[0], 202)
        self.assertTrue(self.store.get(row['id'])['cancelled'])

    def test_terminal_reset_does_not_touch_new_run(self):
        old = self.store.submit(ADMIN, str(uuid.uuid4()), 'D02')
        self.store.finish(old['id'], {'verdict': 'CANCELLED'})
        new = self.store.submit(ADMIN, str(uuid.uuid4()), 'F01')
        generation = self.store.lease()['generation']
        status = self.request('POST', '/lab/api/runs/' + old['id'] + '/reset', {'confirm': True}, signed=True)[0]
        self.assertEqual(status, 200); self.assertEqual(self.store.lease()['generation'], generation)
        self.assertFalse(self.store.get(new['id'])['cancelled'])

    def test_cookie_remapped_to_lab_path(self):
        _, _, headers = self.request('GET', '/lab/auth/csrf', session=None)
        cookie = dict(headers)['Set-Cookie']
        self.assertIn('P09A-CSRF=', cookie); self.assertIn('Path=/lab/', cookie)
        self.assertNotIn('LG-CSRF=', cookie)

    def test_login_session_http_only(self):
        status, _, headers = self.request('POST', '/lab/auth/login', {'email': 'admin@example.test', 'password': 'component'},
                                          session=None, headers={'X-XSRF-TOKEN': 'component-csrf'})
        self.assertEqual(status, 200)
        cookie = dict(headers)['Set-Cookie']
        self.assertIn('HttpOnly', cookie); self.assertIn('P09A-SESSION=', cookie); self.assertIn('Path=/lab/', cookie)

    def test_normal_cookie_never_forwarded(self):
        self.request(session=None, headers={'Cookie': 'LG-SESSION=normal-secret; P09A-SESSION=admin-component'})
        forwarded = self.calls[-1]['headers']['Cookie']
        self.assertNotIn('normal-secret', forwarded); self.assertIn('LG-SESSION=admin-component', forwarded)

    def test_user_headers_do_not_expand_proxy(self):
        self.request(headers={'X-Forwarded-Host': 'evil.example', 'X-Target-URL': 'https://evil.example'})
        self.assertEqual(self.calls[-1]['host'], 'control-api')
        self.assertNotIn('X-Target-URL', self.calls[-1]['headers'])

    def test_unknown_auth_proxy_path_rejected(self):
        self.assertEqual(self.request('GET', '/lab/auth/../../api/v1/transfers')[0], 400)
        self.assertEqual(self.calls, [])

    def test_secrets_absent_from_session_response(self):
        _, content, _ = self.request('GET', '/lab/api/session')
        self.assertNotIn(b'admin-component', content); self.assertNotIn(b'password', content)

    def test_static_asset_has_restrictive_csp(self):
        status, _, headers = self.request('GET', '/lab/')
        self.assertEqual(status, 200)
        self.assertIn("frame-ancestors 'none'", dict(headers)['Content-Security-Policy'])
        self.assertEqual(dict(headers)['Cache-Control'], 'no-store')

    def test_dependency_error_fails_closed(self):
        with patch('server.request', side_effect=TimeoutError('secret=password')):
            status, content, _ = self.request()
        self.assertEqual(status, 503); self.assertNotIn(b'password', content)

    def test_report_requires_authentication(self):
        row = self.store.submit(ADMIN, str(uuid.uuid4()), 'D02')
        path = '/lab/api/runs/' + row['id'] + '/junit'
        self.assertEqual(self.request('GET', path, session=None)[0], 401)

    def test_oversized_body_rejected(self):
        status = self.request('POST', '/lab/api/runs', {'long': 'a' * 17000}, signed=True)[0]
        self.assertEqual(status, 413)


if __name__ == '__main__': unittest.main()
