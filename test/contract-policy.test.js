import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseYamlText, validateContract } from '../src/lib/contract.js';
import { assessCapabilities, assessRisk, checkChangedPaths, checkClaims, checkProposal, isAllowedPath, isProtectedPath, matchesGlob } from '../src/lib/policy.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('the generated contract template validates and YAML duplicate keys are rejected', async () => {
  const template = await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8');
  assert.doesNotThrow(() => validateContract(parseYamlText(template, 'contract.yaml')));
  assert.throws(() => parseYamlText('value: 1\nvalue: 2\n', 'duplicate.yaml'), /Map keys must be unique/);
});

test('token budgets require positive safe integers', async () => {
  const template = parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8'));
  assert.doesNotThrow(() => validateContract({ ...template, budgets: { ...template.budgets, max_tokens: 1 } }));
  assert.throws(() => validateContract({ ...template, budgets: { ...template.budgets, max_tokens: 1.5 } }), /positive safe integer/);
  assert.throws(() => validateContract({ ...template, budgets: { ...template.budgets, max_tokens: Number.MAX_SAFE_INTEGER + 1 } }), /positive safe integer/);
});

test('glob matching supports recursive and single-segment patterns', () => {
  assert.equal(matchesGlob('src/file.js', '**/*'), true);
  assert.equal(matchesGlob('src/nested/file.js', 'src/**/*.js'), true);
  assert.equal(matchesGlob('src/file.test.js', '**/*.test.*'), true);
  assert.equal(matchesGlob('src/file.js', 'src/*.js'), true);
  assert.equal(matchesGlob('src/nested/file.js', 'src/*.js'), false);
});

test('policy protects tests, manifests, local policy, and CI by default', async () => {
  const contract = validateContract(parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8')));
  for (const filename of ['tests/test_gate.py', 'src/unit.test.js', 'package.json', '.evofence/contract.yaml', '.github/workflows/ci.yml']) {
    assert.equal(isProtectedPath(filename, contract), true, filename);
  }
  assert.equal(isAllowedPath('src/new_feature.js', contract), true);
  assert.deepEqual(checkChangedPaths(['src/new_feature.js', 'tests/test_gate.py'], contract), [
    { path: 'tests/test_gate.py', category: 'protected_path' },
  ]);
});

test('proposal and claims require structured evidence fields', () => {
  const proposal = {
    iteration: 1,
    base_sha: 'a'.repeat(40),
    hypothesis: 'A cache will reduce repeated work.',
    problem_evidence: ['The baseline repeats the parse.'],
    proposed_change: 'Cache the parsed result.',
    changed_surface: ['src/parser.js'],
    expected_effect: { primary_metric: 'score', direction: 'increase', minimum_practical_effect: '0.01' },
    possible_regressions: ['Stale result.'],
    requested_capabilities: [],
    falsification_plan: ['Compare repeat inputs.'],
    rollback_plan: 'Remove the cache.',
  };
  assert.equal(checkProposal(proposal), proposal);
  const claims = { status: 'CANDIDATE_READY', claims: [], tests_executed: [], known_failures: [], missing_evidence: [], files_changed: ['src/parser.js'], capabilities_used: [], suggested_gate_checks: [] };
  assert.equal(checkClaims(claims), claims);
  assert.throws(() => checkProposal({ ...proposal, base_sha: 'short' }), /full git commit SHA/);
});

test('capability requests default to denied and risk grows with surface', async () => {
  const contract = validateContract(parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8')));
  assert.equal(assessCapabilities({ requested_capabilities: ['network'] }, contract).allowed, false);
  assert.equal(assessCapabilities({ requested_capabilities: [] }, contract).allowed, true);
  const small = assessRisk(['src/a.js'], { requested_capabilities: [], expected_effect: { primary_metric: contract.objective.name } }, contract);
  const broad = assessRisk(Array.from({ length: 22 }, (_, index) => `src/${index}.js`), { requested_capabilities: [], expected_effect: { primary_metric: contract.objective.name } }, contract);
  assert.ok(broad.score > small.score);
});
