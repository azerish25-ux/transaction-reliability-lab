"""Lab-only durable execution state and evidence. No product imports or fault IO."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from typing import Any, Iterator
from urllib.parse import urlsplit
import uuid
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ACTIVE = ('QUEUED', 'RUNNING', 'CLEANING')
FINAL = {'PASSED', 'FAILED', 'DETECTED', 'SURVIVED', 'INVALID_EXPERIMENT',
         'BASELINE_FAILED', 'CLEANUP_FAILED', 'CANCELLED'}
MODES = {'NONE', 'F01_LATENCY', 'F01_DISCONNECT', 'D02'}
FAULT_SECONDS = 20
RUN_SECONDS = 150
SEED = 74021


class LabError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code, self.status = code, status


class RiskAssertion(AssertionError):
    def __init__(self, assertion_id: str, expected: Any, actual: Any):
        self.assertion_id, self.expected, self.actual = assertion_id, expected, actual
        super().__init__(assertion_id)


def require(condition: bool, assertion_id: str, expected: Any, actual: Any) -> None:
    if not condition:
        raise RiskAssertion(assertion_id, expected, actual)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def timestamp(value: float | None = None) -> str:
    return datetime.fromtimestamp(time.time() if value is None else value, timezone.utc).isoformat()


def valid_uuid(value: Any) -> str:
    if not isinstance(value, str):
        raise LabError('INVALID_ID')
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as error:
        raise LabError('INVALID_ID') from error
    if str(parsed) != value:
        raise LabError('INVALID_ID')
    return value


def catalogue() -> dict[str, Any]:
    return json.loads((HERE / 'catalogue.json').read_text(encoding='utf-8'))


@dataclass(frozen=True)
class Settings:
    instance: str
    source: str
    dirty: bool
    origin: str
    state_dir: Path

    @classmethod
    def environment(cls) -> 'Settings':
        if os.environ.get('LEDGER_LAB_ENABLED') != 'true' or not (HERE / 'LAB_ONLY_BUILD').is_file():
            raise LabError('LAB_BUILD_AND_ENABLEMENT_REQUIRED', 503)
        instance = os.environ.get('LEDGER_LAB_INSTANCE', '')
        source = os.environ.get('LEDGER_LAB_SOURCE', '')
        origin = os.environ.get('LEDGER_LAB_ORIGIN', '')
        parsed = urlsplit(origin)
        try:
            port = parsed.port
        except ValueError as error:
            raise LabError('LAB_LOOPBACK_REQUIRED', 503) from error
        if (not re.fullmatch(r'[a-f0-9]{32}', instance) or not re.fullmatch(r'[a-f0-9]{40}', source)):
            raise LabError('LAB_PROVENANCE_REQUIRED', 503)
        if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or port is None
                or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
                or not 1024 <= port <= 65535 or origin != f'http://127.0.0.1:{port}'):
            raise LabError('LAB_LOOPBACK_REQUIRED', 503)
        return cls(instance, source, os.environ.get('LEDGER_LAB_SOURCE_DIRTY') != 'false',
                   origin, Path('/state'))

    @property
    def database(self) -> str:
        return 'ledgerguard_lab_' + self.instance[:12]


class Store:
    """Two processes share this bounded queue. Only the guardian performs faults.

    The generation CAS prevents an expired/reset request being acknowledged as
    a newer activation. One partial unique index excludes concurrent campaigns.
    """
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / 'p09a.sqlite3'
        with self.db() as db:
            db.executescript('''
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor TEXT NOT NULL,
                scenario TEXT NOT NULL CHECK(scenario IN ('F01','D02')),
                seed INTEGER NOT NULL, created REAL NOT NULL, deadline REAL NOT NULL,
                status TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0,
                result TEXT, UNIQUE(actor, request_id));
              CREATE UNIQUE INDEX IF NOT EXISTS one_active ON runs((1))
                WHERE status IN ('QUEUED','RUNNING','CLEANING');
              CREATE TABLE IF NOT EXISTS lease (
                id INTEGER PRIMARY KEY CHECK(id=1), run_id TEXT,
                desired TEXT NOT NULL DEFAULT 'NONE', applied TEXT NOT NULL DEFAULT 'UNKNOWN',
                generation INTEGER NOT NULL DEFAULT 0, applied_generation INTEGER NOT NULL DEFAULT -1,
                expires REAL NOT NULL DEFAULT 0, guardian REAL NOT NULL DEFAULT 0,
                worker REAL NOT NULL DEFAULT 0, proof TEXT, error TEXT);
              INSERT OR IGNORE INTO lease(id) VALUES(1);
            ''')
        self.path.chmod(0o600)

    @contextmanager
    def db(self, write: bool = False) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=3, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def lease(self) -> dict[str, Any]:
        with self.db() as db:
            return dict(db.execute('SELECT * FROM lease WHERE id=1').fetchone())

    def health(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        lease = self.lease()
        return {'guardianReady': 0 <= now - lease['guardian'] <= 5 and not lease['error'],
                'workerReady': 0 <= now - lease['worker'] <= 5,
                'fault': lease['applied'], 'requestedFault': lease['desired'],
                'expiresAt': timestamp(lease['expires']) if lease['expires'] else None,
                'error': lease['error']}

    def heartbeat(self, process: str, now: float | None = None) -> None:
        if process not in {'worker', 'guardian'}:
            raise ValueError('Unknown process')
        with self.db(write=True) as db:
            db.execute(f'UPDATE lease SET {process}=? WHERE id=1',
                       (time.time() if now is None else now,))

    def submit(self, actor: str, request_id: str, scenario: str, seed: int = SEED) -> dict[str, Any]:
        valid_uuid(actor); valid_uuid(request_id)
        if scenario not in {'F01', 'D02'} or type(seed) is not int or seed != SEED:
            raise LabError('UNIMPLEMENTED_SCENARIO_OR_SEED', 422)
        now = time.time()
        with self.db(write=True) as db:
            old = db.execute('SELECT * FROM runs WHERE actor=? AND request_id=?', (actor, request_id)).fetchone()
            if old:
                if old['scenario'] != scenario or old['seed'] != seed:
                    raise LabError('REQUEST_ID_CONFLICT', 409)
                return self._view(old)
            lease = db.execute('SELECT * FROM lease WHERE id=1').fetchone()
            if (not 0 <= now - lease['guardian'] <= 5 or not 0 <= now - lease['worker'] <= 5
                    or lease['error'] or lease['applied'] != 'NONE' or lease['desired'] != 'NONE'
                    or lease['generation'] != lease['applied_generation']):
                raise LabError('LAB_NOT_READY', 503)
            if db.execute("SELECT 1 FROM runs WHERE status IN ('QUEUED','RUNNING','CLEANING')").fetchone():
                raise LabError('EXPERIMENT_ALREADY_ACTIVE', 409)
            if db.execute('SELECT count(*) FROM runs').fetchone()[0] >= 1000:
                raise LabError('LAB_HISTORY_LIMIT_START_FRESH_INSTANCE', 409)
            run_id = str(uuid.uuid4())
            db.execute('INSERT INTO runs(id,request_id,actor,scenario,seed,created,deadline,status) VALUES(?,?,?,?,?,?,?,?)',
                       (run_id, request_id, actor, scenario, seed, now, now + RUN_SECONDS, 'QUEUED'))
            return self._view(db.execute('SELECT * FROM runs WHERE id=?', (run_id,)).fetchone())

    @staticmethod
    def _view(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        result['result'] = json.loads(result['result']) if result['result'] else None
        return result

    def get(self, run_id: str) -> dict[str, Any]:
        valid_uuid(run_id)
        with self.db() as db:
            row = db.execute('SELECT * FROM runs WHERE id=?', (run_id,)).fetchone()
            if row is None:
                raise LabError('RUN_NOT_FOUND', 404)
            return self._view(row)

    def recent(self) -> list[dict[str, Any]]:
        with self.db() as db:
            return [self._view(row) for row in db.execute('SELECT * FROM runs ORDER BY created DESC,id DESC LIMIT 30')]

    def claim(self) -> dict[str, Any] | None:
        with self.db(write=True) as db:
            row = db.execute("SELECT * FROM runs WHERE status='QUEUED' ORDER BY created LIMIT 1").fetchone()
            if row is None:
                return None
            db.execute("UPDATE runs SET status='RUNNING' WHERE id=?", (row['id'],))
            result = self._view(row); result['status'] = 'RUNNING'
            return result

    def check_run(self, run_id: str) -> None:
        row = self.get(run_id)
        if row['cancelled'] or time.time() > row['deadline'] or row['status'] != 'RUNNING':
            raise LabError('EXPERIMENT_CANCELLED_OR_EXPIRED', 409)

    def request_fault(self, run_id: str, mode: str, seconds: int = FAULT_SECONDS) -> int:
        if mode not in MODES - {'NONE'} or type(seconds) is not int or not 1 <= seconds <= FAULT_SECONDS:
            raise LabError('INVALID_FAULT')
        self.check_run(run_id)
        row = self.get(run_id)
        if (mode.startswith('F01') and row['scenario'] != 'F01') or (mode == 'D02' and row['scenario'] != 'D02'):
            raise LabError('FAULT_SCOPE_MISMATCH')
        now = time.time()
        with self.db(write=True) as db:
            lease = db.execute('SELECT * FROM lease WHERE id=1').fetchone()
            if (lease['desired'] != 'NONE' or lease['applied'] != 'NONE'
                    or lease['generation'] != lease['applied_generation'] or lease['error']
                    or not 0 <= now - lease['guardian'] <= 5):
                raise LabError('FAULT_BUSY_OR_GUARDIAN_UNAVAILABLE', 409)
            db.execute("UPDATE lease SET run_id=?,desired=?,expires=?,generation=generation+1,proof=NULL WHERE id=1",
                       (run_id, mode, min(now + seconds, row['deadline'])))
            return int(db.execute('SELECT generation FROM lease WHERE id=1').fetchone()[0])

    def reset(self, run_id: str | None = None, cancel: bool = False) -> int:
        if run_id is not None:
            valid_uuid(run_id)
        with self.db(write=True) as db:
            lease = db.execute('SELECT * FROM lease WHERE id=1').fetchone()
            if run_id is not None and lease['run_id'] not in {None, run_id} and lease['desired'] != 'NONE':
                raise LabError('FAULT_SCOPE_MISMATCH', 409)
            if cancel and run_id:
                db.execute('UPDATE runs SET cancelled=1 WHERE id=?', (run_id,))
            db.execute("UPDATE lease SET desired='NONE',expires=0,generation=generation+1 WHERE id=1")
            return int(db.execute('SELECT generation FROM lease WHERE id=1').fetchone()[0])

    def acknowledge(self, generation: int, mode: str, proof: dict[str, Any]) -> bool:
        with self.db(write=True) as db:
            cursor = db.execute('UPDATE lease SET applied=?,applied_generation=?,proof=?,error=NULL,guardian=? '
                                'WHERE id=1 AND generation=?',
                                (mode, generation, canonical(proof), time.time(), generation))
            return cursor.rowcount == 1

    def guardian_error(self, code: str) -> None:
        with self.db(write=True) as db:
            db.execute("UPDATE lease SET error=?,desired='NONE',expires=0,generation=generation+1,guardian=? WHERE id=1",
                       (code, time.time()))

    def finish(self, run_id: str, result: dict[str, Any]) -> None:
        if result.get('verdict') not in FINAL:
            raise ValueError('Unknown verdict')
        with self.db(write=True) as db:
            lease = db.execute('SELECT * FROM lease WHERE id=1').fetchone()
            if (lease['desired'] != 'NONE' or lease['applied'] != 'NONE'
                    or lease['generation'] != lease['applied_generation'] or lease['error']):
                result['verdict'] = 'CLEANUP_FAILED'
            db.execute('UPDATE runs SET status=?,result=? WHERE id=?',
                       (result['verdict'], canonical(result), run_id))

    def recover_interrupted(self) -> None:
        # The guardian performs and acknowledges cleanup; a restart never creates
        # a fabricated restoration pass or silently reruns financial intent.
        with self.db(write=True) as db:
            db.execute("UPDATE runs SET cancelled=1 WHERE status IN ('QUEUED','RUNNING','CLEANING')")
        self.reset()


def run_case(test_id: str, function: Any, input_hash: str) -> dict[str, Any]:
    start = time.monotonic()
    result: dict[str, Any] = {'testId': test_id, 'inputSha256': input_hash,
                              'startedAt': timestamp(), 'status': 'ERROR', 'observations': {}}
    try:
        function(result['observations'])
        result['status'] = 'PASS'
    except RiskAssertion as error:
        result.update(status='ASSERTION_FAILURE', assertion={'id': error.assertion_id,
                      'expected': error.expected, 'actual': error.actual})
    except (TimeoutError,):
        result.update(status='TIMEOUT', error={'type': 'TimeoutError'})
    except Exception as error:
        # Exception messages from drivers can contain DSNs/secrets; retain the
        # exception class and explicit safe error code, not raw repr/tracebacks.
        result['error'] = {'type': type(error).__name__}
        if isinstance(error, LabError):
            result['error']['code'] = error.code
    result.update(finishedAt=timestamp(), elapsedSeconds=round(time.monotonic() - start, 6))
    return result


def classify_defect(phases: dict[str, Any], cleanup: dict[str, Any]) -> str:
    if phases.get('baseline', {}).get('status') != 'PASS':
        return 'BASELINE_FAILED'
    if not cleanup.get('restored') or phases.get('restored', {}).get('status') != 'PASS':
        return 'CLEANUP_FAILED'
    mutant = phases.get('mutant', {})
    if mutant.get('status') == 'PASS':
        return 'SURVIVED'
    expected = mutant.get('assertion', {})
    if (mutant.get('status') == 'ASSERTION_FAILURE'
            and expected.get('id') == 'D02_CHANGED_RECIPIENT_REJECTED'
            and expected.get('expected') == 409 and expected.get('actual') in {200, 201}
            and len({p.get('inputSha256') for p in phases.values()}) == 1
            and mutant.get('observations', {}).get('financialStateUnchanged') is True):
        return 'DETECTED'
    return 'INVALID_EXPERIMENT'


def junit(result: dict[str, Any]) -> bytes:
    phases = result.get('phases', {})
    suite = ET.Element('testsuite', name='P09A-' + result['scenario'], tests=str(len(phases)),
                       failures=str(sum(p['status'] == 'ASSERTION_FAILURE' for p in phases.values())),
                       errors=str(sum(p['status'] not in {'PASS', 'ASSERTION_FAILURE'} for p in phases.values())),
                       skipped='0')
    properties = ET.SubElement(suite, 'properties')
    for key in ('runId', 'sourceSha', 'scenario', 'verdict'):
        ET.SubElement(properties, 'property', name=key, value=str(result.get(key, '')))
    for phase, entry in phases.items():
        case = ET.SubElement(suite, 'testcase', classname=result['scenario'] + '.' + phase,
                             name=entry['testId'], time=str(entry.get('elapsedSeconds', 0)))
        if entry['status'] == 'ASSERTION_FAILURE':
            assertion = entry['assertion']
            ET.SubElement(case, 'failure', type='BusinessContractAssertion',
                          message=assertion['id']).text = canonical(assertion)
        elif entry['status'] != 'PASS':
            ET.SubElement(case, 'error', type=entry['status'],
                          message=entry.get('error', {}).get('type', 'ExperimentError'))
        ET.SubElement(case, 'system-out').text = canonical(entry.get('observations', {}))
    return ET.tostring(suite, encoding='utf-8', xml_declaration=True)


def validate_result(result: dict[str, Any], source: str | None = None) -> None:
    if not re.fullmatch(r'[0-9a-f]{40}', result.get('sourceSha', '')):
        raise LabError('EVIDENCE_SOURCE_MISSING')
    if source and result['sourceSha'] != source:
        raise LabError('EVIDENCE_SOURCE_MISMATCH')
    if result.get('dirtySource') is not False:
        raise LabError('EVIDENCE_DIRTY_SOURCE')
    valid_uuid(result.get('runId'))
    if result.get('testCheckpointHoldMs', 0) != 0:
        raise LabError('EVIDENCE_TEST_CHECKPOINT_NOT_QUALIFIED')
    if not result.get('cleanup', {}).get('restored'):
        raise LabError('EVIDENCE_CLEANUP_MISSING')
    cleanup = result['cleanup']
    if (not re.fullmatch(r'[0-9a-f]{64}', cleanup.get('originalFunctionSha256', ''))
            or cleanup['originalFunctionSha256'] != cleanup.get('currentFunctionSha256')
            or cleanup.get('proxyEnabled') is not True or cleanup.get('toxics') != []):
        raise LabError('EVIDENCE_RESTORATION_INVALID')
    phases = result.get('phases', {})
    if result.get('scenario') == 'D02':
        if set(phases) != {'baseline', 'mutant', 'restored'} or classify_defect(phases, cleanup) != 'DETECTED':
            raise LabError('EVIDENCE_DEFECT_NOT_DETECTED')
        activation = result.get('activation', {})
        mutant_hash = activation.get('mutantFunctionSha256', '')
        if (result.get('verdict') != 'DETECTED' or not re.fullmatch(r'[a-f0-9]{64}', mutant_hash)
                or activation.get('currentFunctionSha256') != mutant_hash
                or activation.get('originalFunctionSha256') != cleanup['originalFunctionSha256']
                or mutant_hash == cleanup['originalFunctionSha256'] or activation.get('mode') != 'D02'):
            raise LabError('EVIDENCE_ACTIVATION_MISSING')
    elif result.get('scenario') == 'F01':
        if (set(phases) != {'baseline', 'latency', 'disruption', 'restored'}
                or any(p.get('status') != 'PASS' for p in phases.values()) or result.get('verdict') != 'PASSED'):
            raise LabError('EVIDENCE_RESILIENCE_INCOMPLETE')
        route = result.get('routeProof', {})
        if route.get('proved') is not True or not route.get('targetConnections') or not route.get('proxyAddresses'):
            raise LabError('EVIDENCE_PROXY_ROUTE_MISSING')
        activation = result.get('activation', {})
        latency = activation.get('latency', {}).get('proxy', {})
        disruption = activation.get('disruption', {}).get('proxy', {})
        toxics = latency.get('toxics', [])
        if (disruption.get('enabled') is not False or len(toxics) != 1
                or toxics[0].get('type') != 'latency' or toxics[0].get('stream') != 'downstream'
                or toxics[0].get('attributes', {}).get('latency') != 250):
            raise LabError('EVIDENCE_NETWORK_ACTIVATION_MISSING')
    else:
        raise LabError('EVIDENCE_UNKNOWN_SCENARIO')
    if any(not re.fullmatch(r'[0-9a-f]{64}', p.get('inputSha256', '')) for p in phases.values()):
        raise LabError('EVIDENCE_INPUT_MISSING')
