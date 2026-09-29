"""Verify P09A-specific exclusion in real normal build artifacts, not source flags.

Legacy product test hooks are outside this scoped check; global G12 remains open.
"""
from pathlib import Path
import json
import zipfile
from core import LabError, digest
ROOT = Path(__file__).resolve().parents[2]
TOKENS = (b'LAB_ONLY_BUILD', b'p09a_guard', b'F01_DISCONNECT', b'X-P09A-CSRF',
          b'IF FALSE AND prior.fingerprint<>fingerprint')


def inspect() -> dict:
    jar = ROOT / 'backend/target/ledgerguard.jar'
    frontend = ROOT / 'frontend/dist'
    if not jar.is_file() or not frontend.is_dir():
        raise LabError('NORMAL_BUILD_ARTIFACTS_REQUIRED')
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
    files = [path for path in frontend.rglob('*') if path.is_file()]
    if not files or not (frontend / 'index.html').is_file() or count == 0:
        raise LabError('NORMAL_ARTIFACT_DISCOVERY_EMPTY')
    for path in files:
        if any(token in path.read_bytes() for token in TOKENS):
            raise LabError('P09A_IMPLEMENTATION_FOUND_IN_NORMAL_FRONTEND')
    result = {'scope': 'P09A_SPECIFIC_EXCLUSION_ONLY', 'normalJarSha256': digest(jar.read_bytes()),
              'jarEntriesInspected': count, 'frontendFilesInspected': len(files), 'excluded': True,
              'globalG12Complete': False}
    target = ROOT / '.evidence/p09a'; target.mkdir(parents=True, exist_ok=True)
    (target / 'packaging.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__': print(json.dumps(inspect(), indent=2))
