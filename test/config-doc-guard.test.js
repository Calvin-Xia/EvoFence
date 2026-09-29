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

test('the guard reports open and closed map drift from the schema', () => {
  const capabilitiesClosed = structuredClone(solved);
  capabilitiesClosed.documents.contract.map_paths.find((map) => map.path === 'capabilities').open = false;
  const closedErrors = compareConfigContract(capabilitiesClosed, docs);
  assert.ok(closedErrors.some((error) => error.includes('Open map paths') && error.includes('capabilities')));

  const adaptersOpen = structuredClone(solved);
  adaptersOpen.documents.config.map_paths.find((map) => map.path === 'adapters').open = true;
  const openErrors = compareConfigContract(adaptersOpen, docs);
  assert.ok(openErrors.some((error) => error.includes('Open map paths') && error.includes('adapters')));
  assert.ok(openErrors.some((error) => error.includes('documented closed map open') && error.includes('adapters')));

  const newOpenMap = structuredClone(solved);
  newOpenMap.documents.contract.map_paths.push({ path: 'new_open_map', open: true });
  const newMapErrors = compareConfigContract(newOpenMap, docs);
  assert.ok(newMapErrors.some((error) => error.includes('Open map paths') && error.includes('new_open_map')));
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

test('the guard derives and checks the contract-version exception code', () => {
  assert.equal(solved.documents.contract.failure_code_exceptions.contract_version_present_but_wrong, 'UNSUPPORTED_CONTRACT');
  const failureDrift = docs.replace('keeps `UNSUPPORTED_CONTRACT`', 'keeps `INVALID_CONFIG`');
  const errors = compareConfigContract(solved, failureDrift);
  assert.ok(errors.some((error) => error.includes('failure-code table') && error.includes('contract codes drift')));
  assert.ok(errors.some((error) => error.includes('UNSUPPORTED_CONTRACT')));
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
