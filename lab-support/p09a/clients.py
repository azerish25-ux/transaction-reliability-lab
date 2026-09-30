"""Bounded, allowlisted HTTP clients and a read-only independent SQL oracle."""
from __future__ import annotations
from contextlib import contextmanager
from dataclasses import dataclass
from http.cookies import SimpleCookie
import http.client
import json
import os
import socket
from typing import Any, Iterator

from core import LabError, Settings, canonical, digest, require

MAX_RESPONSE = 1024 * 1024
ACTOR = '00000000-0000-0000-0000-000000000001'
SOURCE = '10000000-0000-0000-0000-000000000001'
DESTINATION = '20000000-0000-0000-0000-000000000001'
ALTERNATE = '30000000-0000-0000-0000-000000000001'
FUNCTION = 'ledger.execute_command(uuid,text,uuid,text,jsonb,uuid)'


@dataclass
class Response:
    status: int
    body: bytes
    headers: list[tuple[str, str]]

    def json(self) -> Any:
        try:
            return json.loads(self.body) if self.body else None
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LabError('DEPENDENCY_RESPONSE_NOT_JSON', 503) from error


def request(host: str, port: int, method: str, path: str, *, body: bytes | None = None,
            headers: dict[str, str] | None = None, timeout: float = 12) -> Response:
    if host not in {'api', 'control-api', 'toxiproxy', '127.0.0.1'} or not path.startswith('/') or path.startswith('//'):
        raise LabError('DEPENDENCY_TARGET_NOT_ALLOWLISTED')
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    values = {'Accept': 'application/json', 'User-Agent': 'LedgerGuard-P09A'}
    if host != 'toxiproxy':
        # Spring's sandbox boundary requires loopback Host even across Docker DNS.
        values['Host'] = '127.0.0.1:8080'
    values.update(headers or {})
    try:
        connection.request(method, path, body=body, headers=values)
        response = connection.getresponse()
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise LabError('DEPENDENCY_RESPONSE_TOO_LARGE', 503)
        # No redirect following: a response cannot expand the allowlist.
        return Response(response.status, data, response.getheaders())
    except (socket.timeout, TimeoutError) as error:
        raise TimeoutError('DEPENDENCY_TIMEOUT') from error
    finally:
        connection.close()


class Api:
    def __init__(self, host: str = 'api'):
        if host not in {'api', 'control-api'}:
            raise ValueError('Unknown API target')
        self.host = host
        self.cookies: dict[str, str] = {}
        self.csrf_header = ''
        self.csrf_token = ''

    def call(self, method: str, path: str, payload: Any = None, key: str | None = None) -> Response:
        if path not in {'/api/v1/auth/csrf', '/api/v1/auth/login', '/api/v1/auth/me',
                        '/api/v1/accounts', '/api/v1/transfers', '/api/v1/payments'}:
            raise LabError('API_PATH_NOT_ALLOWLISTED')
        headers = {'Cookie': '; '.join(k + '=' + v for k, v in self.cookies.items())}
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        if self.csrf_header and method == 'POST':
            headers[self.csrf_header] = self.csrf_token
        if key:
            headers['Idempotency-Key'] = key
        response = request(self.host, 8080, method, path,
                           body=canonical(payload).encode() if payload is not None else None, headers=headers)
        for name, value in response.headers:
            if name.lower() == 'set-cookie':
                jar = SimpleCookie(); jar.load(value)
                for cookie_name, item in jar.items():
                    if cookie_name in {'LG-SESSION', 'LG-CSRF'}:
                        if item['max-age'] == '0':
                            self.cookies.pop(cookie_name, None)
                        else:
                            self.cookies[cookie_name] = item.value
        return response

    def csrf(self) -> None:
        response = self.call('GET', '/api/v1/auth/csrf')
        if response.status != 200:
            raise LabError('FIXTURE_CSRF_FAILED', 503)
        body = response.json()
        if body.get('headerName') not in {'X-CSRF-TOKEN', 'X-XSRF-TOKEN'} or not body.get('token'):
            raise LabError('FIXTURE_CSRF_INVALID', 503)
        self.csrf_header, self.csrf_token = body['headerName'], body['token']

    def login(self, email: str, password: str) -> dict[str, Any]:
        self.csrf()
        response = self.call('POST', '/api/v1/auth/login', {'email': email, 'password': password})
        if response.status != 200:
            raise LabError('FIXTURE_LOGIN_FAILED', 503)
        self.csrf()  # Login deliberately rotates the token.
        return response.json()


class Oracle:
    def __init__(self, settings: Settings):
        self.settings = settings

    @contextmanager
    def connection(self, owner: bool = False) -> Iterator[Any]:
        # Lazy import keeps pure state/verdict tests dependency-free. Missing
        # psycopg is an experiment setup error, never a detected defect.
        import psycopg
        password = os.environ['LEDGER_OWNER_PASSWORD' if owner else 'LEDGER_RUNTIME_PASSWORD']
        with psycopg.connect(host='postgres', port=5432, dbname=self.settings.database,
                             user='ledger_owner' if owner else 'ledger_runtime', password=password,
                             connect_timeout=3, options='-c statement_timeout=5000 -c lock_timeout=2000') as conn:
            if not owner:
                conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            identity = conn.execute('SELECT current_database()').fetchone()[0]
            marker = conn.execute('SELECT instance_id FROM p09a_guard.instance WHERE singleton=1').fetchone()
            if identity != self.settings.database or not marker or marker[0] != self.settings.instance:
                raise LabError('DISPOSABLE_DATABASE_IDENTITY_MISMATCH', 503)
            yield conn

    def snapshot(self) -> dict[str, Any]:
        with self.connection() as conn:
            balances = [list(row) for row in conn.execute(
                'SELECT account_id::text,posted_minor::text,reserved_minor::text,version::text '
                'FROM ledger.account_balances ORDER BY account_id')]
            counts = list(conn.execute('SELECT (SELECT count(*) FROM ledger.transfers),'
                                       '(SELECT count(*) FROM ledger.journals),'
                                       '(SELECT count(*) FROM ledger.journal_entries), '
                                       '(SELECT count(*) FROM ledger.holds), '
                                       '(SELECT count(*) FROM ledger.adjustments), '
                                       '(SELECT count(*) FROM ledger.outbox_events)').fetchone())
            bad_balances = conn.execute('''
                SELECT count(*) FROM ledger.accounts a
                JOIN ledger.account_balances b ON b.account_id=a.id
                LEFT JOIN (SELECT e.account_id,
                  sum(CASE WHEN (x.kind='SANDBOX_FUNDING_ASSET' AND e.side='DEBIT')
                    OR (x.kind='WALLET_LIABILITY' AND e.side='CREDIT')
                    THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END) AS posted
                  FROM ledger.journal_entries e JOIN ledger.accounts x ON x.id=e.account_id
                  GROUP BY e.account_id) j ON j.account_id=a.id
                WHERE b.posted_minor::numeric <> coalesce(j.posted,0)
                  OR b.reserved_minor<0
                  OR b.reserved_minor::numeric <> coalesce((SELECT sum(h.amount_minor::numeric)
                    FROM ledger.holds h WHERE h.account_id=a.id AND h.state='ACTIVE'),0)
                  OR (a.kind='WALLET_LIABILITY' AND b.posted_minor<b.reserved_minor)
            ''').fetchone()[0]
            bad_journals = conn.execute('''
                SELECT count(*) FROM (
                  SELECT j.id FROM ledger.journals j LEFT JOIN ledger.journal_entries e ON e.journal_id=j.id
                  GROUP BY j.id,j.currency HAVING count(e.journal_id)<>2
                    OR coalesce(sum(CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric
                                   ELSE -e.amount_minor::numeric END),1)<>0
                    OR bool_or(e.currency<>j.currency)) mismatches
            ''').fetchone()[0]
        require(bad_balances == 0, 'SQL_BALANCES_MATCH_IMMUTABLE_ENTRIES', 0, bad_balances)
        require(bad_journals == 0, 'SQL_JOURNALS_BALANCED', 0, bad_journals)
        value = {'balances': balances, 'counts': counts, 'balanceDiscrepancies': bad_balances,
                 'journalDiscrepancies': bad_journals}
        value['sha256'] = digest(canonical(value).encode())
        return value

    def operation(self, operation_id: str, amount: str, key: str) -> dict[str, Any]:
        with self.connection() as conn:
            rows = list(conn.execute('SELECT id::text,source_id::text,destination_id::text,amount_minor::text,'
                                     'journal_id::text FROM ledger.transfers WHERE id=%s::uuid', (operation_id,)))
            replay = list(conn.execute("SELECT status,response->>'id' FROM ledger.idempotency_records "
                                      "WHERE actor_id=%s::uuid AND operation_kind='TRANSFER' AND parent_scope='' AND key=%s",
                                      (ACTOR, key)))
            entries = list(conn.execute('SELECT account_id::text,side,amount_minor::text '
                                       'FROM ledger.journal_entries WHERE journal_id='
                                       '(SELECT journal_id FROM ledger.transfers WHERE id=%s::uuid) ORDER BY account_id',
                                       (operation_id,)))
        require(len(rows) == 1, 'SQL_ONE_TRANSFER', 1, len(rows))
        require(rows[0][1:4] == (SOURCE, DESTINATION, amount), 'SQL_TRANSFER_INTENT',
                [SOURCE, DESTINATION, amount], list(rows[0][1:4]))
        expected = [(SOURCE, 'DEBIT', amount), (DESTINATION, 'CREDIT', amount)]
        require(entries == expected, 'SQL_ONE_BALANCED_POSTING', expected, entries)
        require(replay == [(201, operation_id)], 'SQL_ONE_DURABLE_REPLAY', [[201, operation_id]], replay)
        return {'operationId': operation_id, 'journalId': rows[0][4], 'entries': [list(e) for e in entries],
                'durableReplayCount': len(replay)}

    def route_proof(self) -> dict[str, Any]:
        addresses = {entry[4][0] for entry in socket.getaddrinfo('toxiproxy', 15432, type=socket.SOCK_STREAM)}
        with self.connection() as conn:
            rows = list(conn.execute('SELECT pid,host(client_addr),application_name FROM pg_stat_activity '
                                     "WHERE datname=current_database() AND application_name='LedgerGuard-P09A-Target'"))
        require(bool(rows), 'F01_REAL_JDBC_CONNECTION_DISCOVERED', 'nonzero target connections', len(rows))
        actual = {row[1] for row in rows}
        require(actual.issubset(addresses), 'F01_JDBC_USES_TOXIPROXY', sorted(addresses), sorted(actual))
        return {'proved': True, 'database': self.settings.database,
                'proxyAddresses': sorted(addresses), 'targetConnections': [list(r) for r in rows]}
