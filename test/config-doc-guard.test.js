import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {
  compareConfigContract,
  readConfigDoc,
  solveConfigContract,
} from '../scripts/check-config-doc.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const guard = path.join(root, 'scripts', 'check-config-doc.mjs');
const solved = solveConfigContract();
const docs = readConfigDoc();

test('configuration documentation matches the built schema contract', () => {
  assert.deepEqual(compareConfigContract(solved, docs), []);
});

test('the guard reports a required-field addition with its document and path', () => {
  const drifted = structuredClone(solved);
  drifted.documents.contract.required.push('objective.renamed');
  const errors = compareConfigContract(drifted, docs);
  assert.ok(errors.some((error) => error.includes('Required fields/contract') && error.includes('objective.renamed')));
});

test('the guard reports a required-field removal or rename from the document', () => {
  const drifted = docs.replace(
    '`hard_invariants`, `allowed_evolution_surface`',
    '`renamed_invariants`, `allowed_evolution_surface`',
  );
  const errors = compareConfigContract(solved, drifted);
  assert.ok(errors.some((error) => error.includes('Required fields/contract') && error.includes('hard_invariants')));
  assert.ok(errors.some((error) => error.includes('Required fields/contract') && error.includes('renamed_invariants')));
});

test('the guard reports code-default value and failure-code drift', () => {
  const defaultDrift = structuredClone(solved);
  defaultDrift.code_defaults['evidence.max_output_bytes'] = 2048;
  const defaultErrors = compareConfigContract(defaultDrift, docs);
  assert.ok(defaultErrors.some((error) => error.includes('Code defaults') && error.includes('evidence.max_output_bytes')));

  const failureDrift = docs.replace('`INVALID_HOLDOUT`', '`INVALID_CONFIG`');
  const failureErrors = compareConfigContract(solved, failureDrift);
  assert.ok(failureErrors.some((error) => error.includes('failure-code table') && error.includes('holdout')));
});

test('the standalone guard exits zero after reading the built dist schema', () => {
  const result = spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'config-doc guard passed');
});

test('npm and CI expose the guard as an independent gate', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['config:doc'], 'npm run build && node scripts/check-config-doc.mjs');
  assert.doesNotMatch(packageJson.scripts.check, /config:doc/);

  const ci = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /name: config:doc\s+run: npm run config:doc/);
});
