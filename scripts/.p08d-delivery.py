"""One-use exact-source P08D UI delivery; removed by the publishing commit."""
from pathlib import Path
import base64
import hashlib
import lzma
import subprocess

root = Path.cwd()
parts = [root / f'scripts/.p08d-part{i}' for i in (1, 2, 3)]
encoded = ''.join(path.read_text() for path in parts)
patch = lzma.decompress(base64.b64decode(encoded, validate=True))
if hashlib.sha256(patch).hexdigest() != 'b4bf3682778e416c3dbae56cbd201bbc3179f8ac000d372427dc6c838da98bc5':
    raise RuntimeError('P08D source checksum mismatch')
subprocess.run(['git', 'apply', '--check', '-'], input=patch, check=True)
subprocess.run(['git', 'apply', '-'], input=patch, check=True)
subprocess.run(['git', 'add', 'README.md'], check=True)
for path in parts:
    path.unlink()
Path(__file__).unlink()
print('Installed exact locally typechecked P08D UI, browser cases and evidence mapping; full workflow verification pending.')
