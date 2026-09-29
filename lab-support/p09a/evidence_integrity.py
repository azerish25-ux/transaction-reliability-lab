"""Bounded validation of exported P09A evidence; no application or fault IO.

These checks establish artifact consistency, not visual quality or execution by
an independent party. A successful component test is not a live fault result.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import struct
from typing import Any
import xml.etree.ElementTree as ET
import zlib

MAX_XML = 2 * 1024 * 1024
MAX_PNG = 32 * 1024 * 1024
MAX_PIXELS = 32 * 1024 * 1024
MAX_DECODED = 128 * 1024 * 1024
SERVICES = {'postgres', 'toxiproxy', 'api', 'control-api', 'controller', 'guardian'}


class EvidenceIntegrityError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def checked(condition: bool, code: str) -> None:
    if not condition:
        raise EvidenceIntegrityError(code)


def read_artifact(base: Path, path: Path, maximum: int = MAX_PNG) -> bytes:
    """Reject escaped paths, symlinks and oversized artifacts before reading."""
    base, path = base.absolute(), path.absolute()
    checked(base.resolve() == base, 'EVIDENCE_SYMLINK_REJECTED')
    try:
        relative = path.relative_to(base)
    except ValueError as error:
        raise EvidenceIntegrityError('EVIDENCE_PATH_OUTSIDE_ROOT') from error
    checked('..' not in relative.parts, 'EVIDENCE_PATH_OUTSIDE_ROOT')
    candidate = base
    for part in relative.parts:
        candidate = candidate / part
        checked(not candidate.is_symlink(), 'EVIDENCE_SYMLINK_REJECTED')
    checked(candidate.is_file(), 'EVIDENCE_ARTIFACT_MISSING')
    checked(0 < candidate.stat().st_size <= maximum, 'EVIDENCE_ARTIFACT_SIZE_INVALID')
    with candidate.open('rb') as handle:
        data = handle.read(maximum + 1)
    checked(0 < len(data) <= maximum, 'EVIDENCE_ARTIFACT_SIZE_INVALID')
    return data


def validate_junit(actual: bytes, expected: bytes) -> None:
    """Compare every testcase, outcome and observation to the verdict-derived XML."""
    def canonical(data: bytes) -> str:
        checked(0 < len(data) <= MAX_XML, 'EVIDENCE_JUNIT_SIZE_INVALID')
        checked(b'<!DOCTYPE' not in data.upper() and b'<!ENTITY' not in data.upper(),
                'EVIDENCE_JUNIT_DECLARATION_FORBIDDEN')
        try:
            text = data.decode('utf-8')
            checked(ET.fromstring(text).tag == 'testsuite', 'EVIDENCE_JUNIT_ROOT_INVALID')
            return ET.canonicalize(text)
        except (UnicodeDecodeError, ET.ParseError) as error:
            raise EvidenceIntegrityError('EVIDENCE_JUNIT_XML_INVALID') from error
    checked(canonical(actual) == canonical(expected), 'EVIDENCE_JUNIT_VERDICT_MISMATCH')


def validate_png(data: bytes) -> dict[str, int]:
    """Validate complete non-interlaced 8-bit RGB/RGBA Playwright screenshots.

    Verify chunk CRCs, end-of-file, bounded decompression, scanline lengths and
    filter bytes. This deliberately does not certify the screenshot's contents.
    """
    checked(8 < len(data) <= MAX_PNG and data[:8] == b'\x89PNG\r\n\x1a\n',
            'EVIDENCE_SCREENSHOT_INVALID')
    offset, width, height, channels = 8, 0, 0, 0
    chunks: list[bytes] = []
    saw_header = saw_data = ended_data = saw_end = False
    while offset < len(data):
        checked(offset + 12 <= len(data), 'EVIDENCE_PNG_TRUNCATED')
        length = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        checked(length <= MAX_PNG and offset + length + 12 <= len(data), 'EVIDENCE_PNG_TRUNCATED')
        checked(bool(re.fullmatch(b'[A-Za-z]{4}', kind)), 'EVIDENCE_PNG_CHUNK_INVALID')
        payload = data[offset + 8:offset + 8 + length]
        crc = struct.unpack_from('>I', data, offset + 8 + length)[0]
        checked(zlib.crc32(kind + payload) & 0xffffffff == crc, 'EVIDENCE_PNG_CRC_INVALID')
        offset += length + 12
        if not saw_header:
            checked(kind == b'IHDR' and length == 13, 'EVIDENCE_PNG_HEADER_INVALID')
            width, height, depth, colour, compression, filtering, interlace = struct.unpack('>IIBBBBB', payload)
            checked(0 < width <= 16384 and 0 < height <= 16384 and width * height <= MAX_PIXELS,
                    'EVIDENCE_PNG_DIMENSIONS_INVALID')
            checked(depth == 8 and colour in {2, 6} and (compression, filtering, interlace) == (0, 0, 0),
                    'EVIDENCE_PNG_FORMAT_UNSUPPORTED')
            channels = 3 if colour == 2 else 4
            saw_header = True
        elif kind == b'IHDR':
            raise EvidenceIntegrityError('EVIDENCE_PNG_DUPLICATE_HEADER')
        elif kind == b'IDAT':
            checked(not ended_data, 'EVIDENCE_PNG_DATA_ORDER_INVALID')
            chunks.append(payload)
            saw_data = True
        elif kind == b'IEND':
            checked(length == 0 and saw_data and offset == len(data), 'EVIDENCE_PNG_END_INVALID')
            saw_end = True
            break
        else:
            if saw_data:
                ended_data = True
            # Unknown critical chunks may change decoding semantics.
            checked(bool(kind[0] & 32) or (kind == b'PLTE' and not saw_data),
                    'EVIDENCE_PNG_CRITICAL_CHUNK_UNSUPPORTED')
    checked(saw_end, 'EVIDENCE_PNG_END_MISSING')
    row_size = 1 + width * channels
    expected = row_size * height
    checked(expected <= MAX_DECODED, 'EVIDENCE_PNG_DECODE_LIMIT')
    try:
        inflater = zlib.decompressobj()
        raw = inflater.decompress(b''.join(chunks), expected + 1)
    except zlib.error as error:
        raise EvidenceIntegrityError('EVIDENCE_PNG_DATA_INVALID') from error
    checked(len(raw) == expected and inflater.eof and not inflater.unconsumed_tail and not inflater.unused_data,
            'EVIDENCE_PNG_SCANLINES_INVALID')
    checked(all(raw[row * row_size] <= 4 for row in range(height)), 'EVIDENCE_PNG_FILTER_INVALID')
    return {'width': width, 'height': height}


def frontend_manifest(directory: Path) -> dict[str, str]:
    checked(directory.is_dir() and not directory.is_symlink(), 'EVIDENCE_FRONTEND_MISSING')
    files: dict[str, str] = {}
    for path in sorted(directory.rglob('*')):
        checked(not path.is_symlink(), 'EVIDENCE_SYMLINK_REJECTED')
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = hashlib.sha256(read_artifact(directory, path)).hexdigest()
    checked('index.html' in files, 'EVIDENCE_FRONTEND_INDEX_MISSING')
    return files


def validate_images(value: dict[str, Any], source: str, compose_hash: str, instances: set[str]) -> None:
    checked(value.get('sourceSha') == source and value.get('dirtySource') is False
            and value.get('composeSha256') == compose_hash, 'EVIDENCE_IMAGE_PROVENANCE_INVALID')
    instance = value.get('instanceId')
    checked(isinstance(instance, str) and bool(re.fullmatch('[a-f0-9]{32}', instance))
            and instances == {instance}, 'EVIDENCE_IMAGE_INSTANCE_MISMATCH')
    images = value.get('imageIds')
    checked(isinstance(images, dict) and set(images) == SERVICES, 'EVIDENCE_IMAGE_SERVICES_INVALID')
    checked(all(isinstance(image, str) and re.fullmatch('sha256:[a-f0-9]{64}', image)
                for image in images.values()), 'EVIDENCE_IMAGE_ID_INVALID')
