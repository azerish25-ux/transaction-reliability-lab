"""Regression tests for evidence validation, not substitutes for product tests."""
import copy
import runpy
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

GATE = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/assert-p08f-evidence'))


class EvidenceGateTest(unittest.TestCase):
    def suite(self, root, minimum=1):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'results.xml'
            ET.ElementTree(root).write(path)
            return GATE['suite'](path, minimum)

    def fixture(self):
        root = ET.Element('testsuite', tests='1', failures='0', errors='0', skipped='0')
        ET.SubElement(root, 'testcase', name='P08FIT13_eventVersionsRemainNumericallyOrderedBeyondNine', classname='Admin')
        return root

    def test_actual_numeric_ordering_identity_is_required(self):
        _, cases, _ = self.suite(self.fixture())
        self.assertEqual(1, len(GATE['matches'](cases, 'P08FIT13')))
        self.assertEqual([], GATE['matches'](cases, 'P08FIT13_outboxVersionsSortNumericallyBeyondNine'))

    def test_missing_or_renamed_case_cannot_satisfy_mapping(self):
        _, cases, _ = self.suite(self.fixture())
        for name in ['P08FIT130_notTheRequiredCase', 'unrelated_P08FIT13']:
            cases[0].set('name', name)
            self.assertEqual([], GATE['matches'](cases, 'P08FIT13'))
        with self.assertRaises(ValueError):
            GATE['require_ids']([], 'P08FIT', 13, 'integration')

    def test_hidden_failed_skipped_and_retried_cases_rejected(self):
        for tag in GATE['NONPASSING']:
            with self.subTest(tag=tag):
                root = self.fixture()
                ET.SubElement(root.find('testcase'), tag)
                with self.assertRaises(ValueError):
                    self.suite(root)

    def test_duplicate_cases_rejected_even_when_totals_agree(self):
        root = self.fixture()
        root.append(copy.deepcopy(root.find('testcase')))
        root.set('tests', '2')
        with self.assertRaises(ValueError):
            self.suite(root)

    def test_aggregate_and_leaf_counts_must_agree(self):
        root = ET.Element('testsuites', tests='2', failures='0', errors='0', skipped='0')
        root.append(self.fixture())
        with self.assertRaises(ValueError):
            self.suite(root)
        root.set('tests', '1')
        self.assertEqual(1, self.suite(root)[0]['tests'])

    def test_short_empty_and_negative_results_rejected(self):
        with self.assertRaises(ValueError):
            self.suite(self.fixture(), minimum=2)
        root = self.fixture()
        root.set('failures', '-1')
        with self.assertRaises(ValueError):
            self.suite(root)
        with self.assertRaises(ValueError):
            self.suite(ET.Element('testsuites', tests='0'))

    def evidence_inputs(self, root):
        def write(relative, suites):
            document = ET.Element('testsuites')
            for filename, project, prefix, count in suites:
                group = ET.SubElement(document, 'testsuite', name=filename, hostname=project,
                                      tests=str(count), failures='0', errors='0', skipped='0')
                for number in range(1, count + 1):
                    ET.SubElement(group, 'testcase', name=f'{prefix}{number:02}_fixture', classname=filename)
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            ET.ElementTree(document).write(path)
        write('.evidence/client/p08f-results.xml', [('client', '', 'P08FTS', 24)])
        write('backend/target/surefire-reports/TEST-lab.ledgerguard.admin.AdminFiltersTest.xml', [('unit', '', 'P08FUT', 12)])
        write('backend/target/failsafe-reports/TEST-lab.ledgerguard.AdministratorInvestigationIT.xml', [('api', '', 'P08FIT', 13)])
        groups = [('earlier', '', 'OLD', 114)]
        for project in GATE['PROJECTS']:
            groups.extend([('p08f.spec.ts', project, 'P08FE2E', 10), ('p08f-table.spec.ts', project, 'P08FLAYOUT', 1)])
        write('.evidence/playwright/junit.xml', groups)
        return {'fullProductStatus': 'INCOMPLETE_NO_GO', 'requirements': [
            {'id': f'P08F{i:02}', 'tests': {'p08f-layout': ['P08FLAYOUT01']}} for i in range(1, 8)]}

    def test_layout_suite_maps_to_all_three_executed_projects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.evidence_inputs(root)
            result = GATE['executed_evidence'](root, manifest)
            self.assertEqual(3, result['p08fLayoutCases'])
            self.assertEqual(30, result['p08fBrowserCases'])
            self.assertEqual(7, len(result['requirements']))
            self.assertTrue(all(len(r['executed']) == 3 for r in result['requirements']))

    def test_wrong_project_or_unknown_suite_cannot_be_certified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.evidence_inputs(root)
            invalid = copy.deepcopy(manifest)
            invalid['requirements'][0]['tests'] = {'unknown': ['P08FLAYOUT01']}
            with self.assertRaisesRegex(ValueError, 'Unknown'):
                GATE['executed_evidence'](root, invalid)
            path = root / '.evidence/playwright/junit.xml'
            tree = ET.parse(path)
            tree.getroot().findall('testsuite')[-1].set('hostname', 'wrong-project')
            tree.write(path)
            with self.assertRaisesRegex(ValueError, 'Missing or duplicate browser suite'):
                GATE['executed_evidence'](root, manifest)

    def test_recording_policy_ignores_formatting_not_values(self):
        for source in ["test.use({ trace: 'off', video: 'off', screenshot: 'off' });",
                       'test.use({trace:"off",video:"off",screenshot:"off",actionTimeout:10000});']:
            self.assertTrue(GATE['recordings_disabled'](source))
        for source in ["test.use({trace:'on',video:'off',screenshot:'off'});",
                       "test.use({trace:'off'});test.use({video:'off',screenshot:'off'});", '']:
            self.assertFalse(GATE['recordings_disabled'](source))


if __name__ == '__main__':
    unittest.main()
