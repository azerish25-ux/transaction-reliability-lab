"""Verify P09A-specific exclusion in built normal artifacts, including nested JARs.

Legacy product test hooks are outside this scoped check; global G12 remains open.
"""
from pathlib import Path, PurePosixPath
import io
import json
import subprocess
import zipfile
from core import LabError, digest
from evidence_integrity import frontend_manifest, read_artifact

ROOT = Path(__file__).resolve().parents[2]
TOKENS = (b'ReceiverFaultBehaviorProvider', b'ProcessDeathFaults', b'lab/ledgerguard/verification/', b'LAB_ONLY_BUILD', b'p09a_guard', b'F01_DISCONNECT', b'X-P09A-CSRF',
          b'IF FALSE AND prior.fingerprint<>fingerprint')
MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 100000
MAX_ARCHIVE_DEPTH = 4


def lab_path(name: str) -> bool:
    parts = PurePosixPath(name.replace('\\', '/').lower()).parts
    return any(part in {'lab-support', 'p09a', 'lab_only_build'} or part.startswith('p09a_')
               for part in parts)


def scan_archive(source, counters: dict[str, int], depth: int = 0) -> None:
    if depth > MAX_ARCHIVE_DEPTH:
        raise LabError('NORMAL_ARTIFACT_ARCHIVE_DEPTH_EXCEEDED')
    with zipfile.ZipFile(source) as archive:
        names = set()
        for entry in archive.infolist():
            if entry.filename in names:
                raise LabError('NORMAL_ARTIFACT_DUPLICATE_ENTRY')
            names.add(entry.filename)
            if lab_path(entry.filename):
                raise LabError('P09A_IMPLEMENTATION_FOUND_IN_NORMAL_JAR')
            if entry.is_dir():
                continue
            counters['entries'] += 1
            counters['bytes'] += entry.file_size
            if (entry.file_size > MAX_ENTRY_BYTES or counters['bytes'] > MAX_TOTAL_BYTES
                    or counters['entries'] > MAX_ENTRIES):
                raise LabError('NORMAL_ARTIFACT_INSPECTION_BUDGET_EXCEEDED')
            value = archive.read(entry)
            if any(token in value or token.lower() in entry.filename.lower().encode() for token in TOKENS):
                raise LabError('P09A_IMPLEMENTATION_FOUND_IN_NORMAL_JAR')
            if entry.filename.lower().endswith(('.jar', '.zip')) or zipfile.is_zipfile(io.BytesIO(value)):
                counters['archives'] += 1
                scan_archive(io.BytesIO(value), counters, depth + 1)


def inspect() -> dict:
    jar = ROOT / 'backend/target/ledgerguard.jar'
    frontend = ROOT / 'frontend/dist'
    if not jar.is_file() or not frontend.is_dir():
        raise LabError('NORMAL_BUILD_ARTIFACTS_REQUIRED')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=ROOT, text=True).strip())
    if dirty:
        raise LabError('NORMAL_PACKAGING_DIRTY_SOURCE')
    counters = {'entries': 0, 'bytes': 0, 'archives': 1}
    jar_bytes = read_artifact(ROOT, jar, maximum=MAX_TOTAL_BYTES)
    scan_archive(io.BytesIO(jar_bytes), counters)
    paths = list(frontend.rglob('*'))
    if any(path.is_symlink() for path in paths):
        raise LabError('NORMAL_FRONTEND_SYMLINK_NOT_ALLOWED')
    files = [path for path in paths if path.is_file()]
    if (len(files) > MAX_ENTRIES or sum(path.stat().st_size for path in files) > MAX_TOTAL_BYTES
            or any(path.stat().st_size > MAX_ENTRY_BYTES for path in files)):
        raise LabError('NORMAL_ARTIFACT_INSPECTION_BUDGET_EXCEEDED')
    manifest = frontend_manifest(frontend)
    if counters['entries'] == 0:
        raise LabError('NORMAL_ARTIFACT_DISCOVERY_EMPTY')
    # Bound aggregate expansion across all frontend archives, not per ZIP file.
    frontend_counters = {'entries': 0, 'bytes': 0, 'archives': 0}
    for name, expected in manifest.items():
        path = frontend / name
        value = read_artifact(frontend, path, maximum=MAX_ENTRY_BYTES)
        if digest(value) != expected:
            raise LabError('NORMAL_FRONTEND_CHANGED_DURING_INSPECTION')
        if lab_path(name) or any(token in value or token.lower() in name.lower().encode() for token in TOKENS):
            raise LabError('P09A_IMPLEMENTATION_FOUND_IN_NORMAL_FRONTEND')
        if path.suffix.lower() in {'.jar', '.zip'} or zipfile.is_zipfile(io.BytesIO(value)):
            frontend_counters['archives'] += 1
            scan_archive(io.BytesIO(value), frontend_counters)
    result = {'scope': 'P09A_SPECIFIC_EXCLUSION_ONLY', 'sourceSha': source, 'dirtySource': False,
              'normalJarSha256': digest(jar_bytes), 'normalFrontendSha256': manifest,
              'jarEntriesInspected': counters['entries'], 'archivesInspected': counters['archives'],
              'frontendArchivesInspected': frontend_counters['archives'],
              'frontendFilesInspected': len(manifest), 'excluded': True, 'globalG12Complete': False}
    target = ROOT / '.evidence/p09a'; target.mkdir(parents=True, exist_ok=True)
    (target / 'packaging.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__': print(json.dumps(inspect(), indent=2))
