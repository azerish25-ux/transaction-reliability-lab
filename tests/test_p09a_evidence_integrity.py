"""Artifact-validation regressions; synthetic fixtures are not live P09A evidence."""
from __future__ import annotations
import hashlib
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lab-support/p09a'))
from check_restored import diagnostic
from evidence_integrity import (EvidenceIntegrityError, SERVICES, frontend_manifest,
                                read_artifact, validate_images, validate_junit, validate_png)


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


def png(width=2, height=2, raw=None, ending=True):
    rows = bytes([0, 1, 2, 3, 4, 5, 6]) * height if raw is None else raw
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + (chunk(b'IEND', b'') if ending else b''))


class JunitIntegrityTests(unittest.TestCase):
    XML = b'<testsuite tests="1" failures="1"><testcase name="mutant"><failure message="D02_CHANGED_RECIPIENT_REJECTED">409 != 201</failure></testcase></testsuite>'

    def test_matching_assertion_accepted(self):
        validate_junit(self.XML, self.XML)

    def test_attribute_order_is_not_significant(self):
        validate_junit(self.XML.replace(b'tests="1" failures="1"', b'failures="1" tests="1"'), self.XML)

    def test_same_totals_wrong_assertion_rejected(self):
        with self.assertRaisesRegex(EvidenceIntegrityError, 'VERDICT_MISMATCH'):
            validate_junit(self.XML.replace(b'D02_CHANGED_RECIPIENT_REJECTED', b'UNRELATED_ASSERTION'), self.XML)

    def test_same_totals_wrong_test_identity_rejected(self):
        with self.assertRaises(EvidenceIntegrityError):
            validate_junit(self.XML.replace(b'name="mutant"', b'name="other"'), self.XML)

    def test_hidden_skipped_case_rejected(self):
        with self.assertRaises(EvidenceIntegrityError):
            validate_junit(self.XML.replace(b'</testcase>', b'<skipped/></testcase>'), self.XML)

    def test_changed_observation_rejected(self):
        with self.assertRaises(EvidenceIntegrityError):
            validate_junit(self.XML.replace(b'409 != 201', b'409 != 500'), self.XML)

    def test_entity_declaration_rejected(self):
        with self.assertRaisesRegex(EvidenceIntegrityError, 'DECLARATION_FORBIDDEN'):
            validate_junit(b'<!DOCTYPE testsuite [<!ENTITY x "text">]>' + self.XML, self.XML)

    def test_invalid_encoding_rejected(self):
        with self.assertRaises(EvidenceIntegrityError):
            validate_junit(b'\xff', self.XML)


class ScreenshotIntegrityTests(unittest.TestCase):
    def test_real_rgb_fixture_accepted(self):
        self.assertEqual(validate_png(png()), {'width': 2, 'height': 2})

    def test_header_only_not_a_screenshot(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(b'\x89PNG\r\n\x1a\n')

    def test_bad_crc_rejected(self):
        data = bytearray(png()); data[-1] ^= 1
        with self.assertRaisesRegex(EvidenceIntegrityError, 'CRC_INVALID'): validate_png(bytes(data))

    def test_truncated_chunk_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png()[:-2])

    def test_missing_end_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png(ending=False))

    def test_trailing_payload_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png() + b'not-image-data')

    def test_zero_dimension_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png(width=0))

    def test_dimension_bomb_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png(width=1000000))

    def test_truncated_scanlines_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png(raw=b'\x00'))

    def test_decompression_overflow_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png(raw=b'\x00' * 100000))

    def test_invalid_filter_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): validate_png(png(raw=b'\x05' + b'\x00' * 13))

    def test_concatenated_zlib_stream_rejected(self):
        data = png(ending=False)
        with self.assertRaises(EvidenceIntegrityError):
            validate_png(data + chunk(b'IDAT', zlib.compress(b'extra')) + chunk(b'IEND', b''))


class ArtifactProvenanceTests(unittest.TestCase):
    def test_frontend_manifest_binds_every_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'index.html').write_text('index'); (root / 'app.js').write_text('app')
            before = frontend_manifest(root)
            self.assertEqual(before['app.js'], hashlib.sha256(b'app').hexdigest())
            (root / 'app.js').write_text('changed')
            self.assertNotEqual(before, frontend_manifest(root))

    def test_symlink_file_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'actual').write_text('data'); (root / 'index.html').symlink_to(root / 'actual')
            with self.assertRaises(EvidenceIntegrityError): frontend_manifest(root)

    def test_parent_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'real').mkdir(); (root / 'real/file').write_text('data')
            (root / 'alias').symlink_to(root / 'real', target_is_directory=True)
            with self.assertRaises(EvidenceIntegrityError): read_artifact(root, root / 'alias/file')

    def test_symlink_above_artifact_root_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'real/sub').mkdir(parents=True)
            (root / 'real/sub/file').write_text('data')
            (root / 'alias').symlink_to(root / 'real', target_is_directory=True)
            with self.assertRaises(EvidenceIntegrityError):
                read_artifact(root / 'alias/sub', root / 'alias/sub/file')

    def test_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'child').mkdir(); (root / 'outside').write_text('data')
            with self.assertRaises(EvidenceIntegrityError): read_artifact(root / 'child', root / 'outside')

    def test_oversized_artifact_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'file').write_bytes(b'12345')
            with self.assertRaises(EvidenceIntegrityError): read_artifact(root, root / 'file', maximum=4)

    def test_missing_frontend_index_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(EvidenceIntegrityError): frontend_manifest(Path(temporary))

    def image_proof(self):
        return {'sourceSha': 'a' * 40, 'dirtySource': False, 'composeSha256': 'b' * 64,
                'instanceId': 'c' * 32, 'imageIds': {name: 'sha256:' + 'd' * 64 for name in SERVICES}}

    def check_images(self, value, instances=None):
        validate_images(value, 'a' * 40, 'b' * 64, {'c' * 32} if instances is None else instances)

    def test_valid_image_ids_accepted(self): self.check_images(self.image_proof())

    def test_image_tag_instead_of_digest_rejected(self):
        proof = self.image_proof(); proof['imageIds']['api'] = 'ledgerguard:latest'
        with self.assertRaises(EvidenceIntegrityError): self.check_images(proof)

    def test_mixed_instance_evidence_rejected(self):
        with self.assertRaises(EvidenceIntegrityError): self.check_images(self.image_proof(), {'c' * 32, 'e' * 32})

    def test_dirty_image_source_rejected(self):
        proof = self.image_proof(); proof['dirtySource'] = True
        with self.assertRaises(EvidenceIntegrityError): self.check_images(proof)

    def test_missing_service_rejected(self):
        proof = self.image_proof(); del proof['imageIds']['guardian']
        with self.assertRaises(EvidenceIntegrityError): self.check_images(proof)

    def test_wrong_source_rejected(self):
        proof = self.image_proof(); proof['sourceSha'] = 'f' * 40
        with self.assertRaises(EvidenceIntegrityError): self.check_images(proof)


class TeardownDiagnosticTests(unittest.TestCase):
    def test_safe_error_code_is_visible(self):
        self.assertEqual(diagnostic({'error': 'D02_BACKUP_INTEGRITY_FAILURE'})['guardianError'],
                         'D02_BACKUP_INTEGRITY_FAILURE')

    def test_secret_exception_text_is_not_visible(self):
        self.assertEqual(diagnostic({'error': 'password=private-value'})['guardianError'], 'REDACTED_OR_ABSENT')

    def test_log_injection_is_not_visible(self):
        self.assertEqual(diagnostic({'error': 'Unsafe\nforged log'})['guardianError'], 'REDACTED_OR_ABSENT')

    def test_unknown_fields_are_not_exported(self):
        self.assertNotIn('secret', str(diagnostic({'token': 'secret', 'proof': {'password': 'secret'}})))

    def test_missing_generations_not_acknowledged(self):
        self.assertFalse(diagnostic({})['generationAcknowledged'])

    def test_real_generation_comparison(self):
        self.assertTrue(diagnostic({'generation': 2, 'applied_generation': 2})['generationAcknowledged'])
        self.assertFalse(diagnostic({'generation': 3, 'applied_generation': 2})['generationAcknowledged'])


if __name__ == '__main__': unittest.main()
