"""Verify P09A-specific exclusion in real normal build artifacts, not source flags.

Legacy product test hooks are outside this scoped check; global G12 remains open.
"""
from pathlib import Path
import json
import subprocess
import zipfile
from core import LabError, digest
from evidence_integrity import frontend_manifest
ROOT = Path(__file__).resolve().parents[2]
TOKENS = (b'LAB_ONLY_BUILD', b'p09a_guard', b'F01_DISCONNECT', b'X-P09A-CSRF',
          b'IF FALSE AND prior.fingerprint<>fingerprint')


def inspect() -> dict:
    jar = ROOT / 'backend/target/ledgerguard.jar'
    frontend = ROOT / 'frontend/dist'
    if not jar.is_file() or not frontend.is_dir():
        raise LabError('NORMAL_BUILD_ARTIFACTS_REQUIRED')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=ROOT, text=True).strip())
    if dirty:
        raise LabError('NORMAL_PACKAGING_DIRTY_SOURCE')
    count = 0
    with zipfile.ZipFile(jar) as archive:
        for name in archive.namelist():
            # Third-party dependency JARs do not contain our first-party lab source.
            if name.endswith('.jar') or name.endswith('/'):
                continue
            value = archive.read(name)
            if any(token in value or token.lower() in name.lower().encode() for token in TOKENS):
                raise LabError('P09A_IMPLEMENTATION_FOUND_IN_NORMAL_JAR')
            count += 1
    manifest = frontend_manifest(frontend)
    if count == 0:
        raise LabError('NORMAL_ARTIFACT_DISCOVERY_EMPTY')
    for name in manifest:
        if any(token in (frontend / name).read_bytes() for token in TOKENS):
            raise LabError('P09A_IMPLEMENTATION_FOUND_IN_NORMAL_FRONTEND')
    result = {'scope': 'P09A_SPECIFIC_EXCLUSION_ONLY', 'sourceSha': source, 'dirtySource': False,
              'normalJarSha256': digest(jar.read_bytes()), 'normalFrontendSha256': manifest,
              'jarEntriesInspected': count, 'frontendFilesInspected': len(manifest), 'excluded': True,
              'globalG12Complete': False}
    target = ROOT / '.evidence/p09a'; target.mkdir(parents=True, exist_ok=True)
    (target / 'packaging.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__': print(json.dumps(inspect(), indent=2))
