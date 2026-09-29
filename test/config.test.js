// Acceptance oracle for the v2 config surface (`src/lib/config/**`) and for the
// `status`/`init` wiring that node `l2_config` added.
//
// Two layers of evidence:
//   1. Pure validator tests, including a RULE-PARITY loop against the 0.3.0 gate validator
//      (`dist/lib/contract.js`): every `required` schema path must make BOTH validators fail
//      when deleted, and every `defaulted` path must make BOTH accept its absence. That loop is
//      what locks "exactly two code defaults, everything else fail-closed" (DoD 4/5).
//   2. End-to-end CLI tests against a real `git init` + `evofence init` repository, asserting
//      the exit codes and the rejected/missing field names in stderr (DoD 1/2/3).
//
// Imports come from `dist/` on purpose (ADR-0002/0004: the build artifact is the tested
// object; `npm test` builds first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import {
  CONFIG_SCHEMA,
  CONTRACT_DEFAULTS,
  CONTRACT_SCHEMA,
  defaultedFieldPaths,
  loadRequiredConfigDocumentSync,
  loadRequiredContractDocumentSync,
  normalizedDocument,
  requiredFieldPaths,
  validateDocument,
} from '../dist/lib/config/index.js';
import { parseYamlText, validateContract } from '../dist/lib/contract.js';

const TEMPLATE = await readFile(fileURLToPath(new URL('../templates/contract.yaml', import.meta.url)), 'utf8');
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const CONFIG_TEXT = `version: 1
adapters:
  codex:
    command: codex
    model: null
  opencode:
    command: opencode
    model: null
    agent: null
  claude:
    command: claude
    model: null
    agent: null
  pi:
    command: pi
    model: null
`;

function templateContract() {
  return parseYamlText(TEMPLATE, 'contract.yaml');
}

function deletePath(target, dotted) {
  const parts = dotted.split('.');
  const last = parts.pop();
  let node = target;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return;
    node = node[part];
  }
  if (node !== null && typeof node === 'object') delete node[last];
}

function readPath(target, dotted) {
  let node = target;
  for (const part of dotted.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function contractReport(value) {
  return validateDocument('contract', value, '<fixture>/.evofence/contract.yaml');
}

/* ------------------------------------------------------------------ *
 * 1. the code-default boundary (DoD 4/5)
 * ------------------------------------------------------------------ */

test('exactly two contract fields carry a code default', () => {
  assert.deepEqual(CONTRACT_DEFAULTS, {
    'evidence.per_command_timeout_ms': 120000,
    'evidence.max_output_bytes': 1048576,
  });
  assert.deepEqual(defaultedFieldPaths(CONTRACT_SCHEMA), [
    'evidence.per_command_timeout_ms',
    'evidence.max_output_bytes',
  ]);
});

test('every required contract path is fail-closed and matches the 0.3.0 gate validator', () => {
  const required = requiredFieldPaths(CONTRACT_SCHEMA);
  for (const anchor of ['contract_version', 'objective', 'objective.name', 'hard_invariants', 'allowed_evolution_surface', 'protected_paths', 'evidence.public_commands', 'acceptance.require_rollback_point', 'acceptance.hidden_regression_tolerance', 'capabilities.authority_ceiling', 'budgets', 'budgets.max_iterations', 'budgets.max_tokens', 'budgets.max_usd']) {
    assert.ok(required.includes(anchor), `schema must require ${anchor}`);
  }

  for (const dotted of required) {
    const value = templateContract();
    deletePath(value, dotted);

    const report = contractReport(value);
    assert.equal(report.valid, false, `removing ${dotted} must invalidate the document`);
    assert.ok(report.missing_fields.includes(dotted), `removing ${dotted} must be reported as missing, got ${JSON.stringify(report.missing_fields)}`);
    assert.equal(readPath(normalizedDocument('contract', value), dotted), undefined, `${dotted} must not be silently defaulted`);

    // Parity with the shipped 0.3.0 validator: it must refuse the same document.
    assert.throws(
      () => validateContract(value),
      (error) => error?.name === 'EvoFenceError',
      `0.3.0 validateContract must also reject a contract without ${dotted}`,
    );
  }
});

test('the two defaulted paths stay optional, are filled exactly, and match the 0.3.0 gate validator', () => {
  for (const dotted of defaultedFieldPaths(CONTRACT_SCHEMA)) {
    const value = templateContract();
    deletePath(value, dotted);

    const report = contractReport(value);
    assert.equal(report.valid, true, `${dotted} must stay optional`);
    assert.equal(report.missing_fields.includes(dotted), false, `${dotted} must not be reported missing`);
    assert.ok(report.accepted_fields.includes(dotted), `${dotted} must show up as an accepted defaulted field`);
    assert.equal(readPath(normalizedDocument('contract', value), dotted), CONTRACT_DEFAULTS[dotted]);
    assert.doesNotThrow(() => validateContract(value), `0.3.0 validateContract must accept a contract without ${dotted}`);
  }
});

test('template-only optional keys stay optional (no new requirement)', () => {
  const value = templateContract();
  for (const dotted of ['acceptance.require_proposal', 'acceptance.require_claims', 'acceptance.require_objective_improvement']) {
    deletePath(value, dotted);
  }
  assert.equal(contractReport(value).valid, true);
});

test('a missing contract_version is reported as missing (INVALID_CONTRACT), not as an unsupported version', () => {
  const value = templateContract();
  delete value.contract_version;
  const report = contractReport(value);
  assert.deepEqual(report.missing_fields, ['contract_version']);
  assert.deepEqual(report.rejected_fields, []);
  assert.equal(report.valid, false);
});

test('a present but unsupported contract_version keeps the UNSUPPORTED_CONTRACT code', () => {
  const value = templateContract();
  value.contract_version = 2;
  const report = contractReport(value);
  assert.ok(report.rejected_fields.some((issue) => issue.path === 'contract_version' && issue.code === 'UNSUPPORTED_CONTRACT'));
});

/* ------------------------------------------------------------------ *
 * 2. unknown keys and value rules
 * ------------------------------------------------------------------ */

test('v2 rejects unknown keys instead of ignoring them', () => {
  const value = templateContract();
  value.budget = { max_iterations: 20 }; // typo of `budgets`
  value.objective.metric = 'score';

  const report = contractReport(value);
  assert.equal(report.valid, false);
  assert.deepEqual(report.rejected_fields.map((issue) => issue.path).sort(), ['budget', 'objective.metric']);
  assert.ok(report.rejected_fields.every((issue) => issue.code === 'INVALID_CONTRACT'));

  // Documented divergence: 0.3.0 had no `additionalProperties: false` semantics and silently
  // accepted these keys.
  assert.doesNotThrow(() => validateContract(value));
});

test('the capabilities map stays open because capability names are dynamic', () => {
  const value = templateContract();
  value.capabilities.telemetry_export = 'deny';
  value.capabilities.external_api = { mode: 'allow' };
  assert.equal(contractReport(value).valid, true);
});

test('capability values accept the three allow forms and their explicit denials', () => {
  const settings = [true, 'allow', { mode: 'allow' }, false, 'deny', { mode: 'deny' }];
  for (const setting of settings) {
    const value = templateContract();
    value.capabilities.telemetry_export = setting;
    const report = contractReport(value);
    assert.equal(report.valid, true, `${JSON.stringify(setting)} must be accepted: ${JSON.stringify(report.rejected_fields)}`);
  }
  assert.equal(contractReport(templateContract()).valid, true, 'template defaults must remain valid');
});

test('capability values reject malformed open-map entries with INVALID_CONTRACT', () => {
  const cases = [
    ['network', [1, 2, 3]],
    ['telemetry_export', 7],
    ['shell', 'evidence_commands_only'],
  ];
  for (const [name, setting] of cases) {
    const value = templateContract();
    value.capabilities[name] = setting;
    const report = contractReport(value);
    assert.equal(report.valid, false, `${name} must be rejected`);
    assert.ok(report.rejected_fields.some((issue) => issue.path === `capabilities.${name}` && issue.code === 'INVALID_CONTRACT'), JSON.stringify(report.rejected_fields));
  }
});

test('contract value rules reject the same documents the 0.3.0 validator rejects', () => {
  const cases = [
    { path: 'contract_version', code: 'UNSUPPORTED_CONTRACT', mutate: (value) => { value.contract_version = 2; } },
    { path: 'objective.direction', mutate: (value) => { value.objective.direction = 'sideways'; } },
    { path: 'objective.min_delta', mutate: (value) => { value.objective.min_delta = -1; } },
    { path: 'objective.name', mutate: (value) => { value.objective.name = '   '; } },
    { path: 'allowed_evolution_surface', mutate: (value) => { value.allowed_evolution_surface = 'src/**'; } },
    { path: 'protected_paths', mutate: (value) => { value.protected_paths = [1]; } },
    { path: 'hard_invariants[1].id', mutate: (value) => { value.hard_invariants = [{ id: 'a', command: 'x' }, { id: 'a', command: 'y' }]; } },
    { path: 'evidence.public_commands', mutate: (value) => { value.evidence.public_commands = [1]; } },
    { path: 'evidence.per_command_timeout_ms', mutate: (value) => { value.evidence.per_command_timeout_ms = 50; } },
    { path: 'evidence.max_output_bytes', mutate: (value) => { value.evidence.max_output_bytes = 10; } },
    { path: 'acceptance.require_rollback_point', mutate: (value) => { value.acceptance.require_rollback_point = false; } },
    { path: 'acceptance.hidden_regression_tolerance', mutate: (value) => { value.acceptance.hidden_regression_tolerance = -1; } },
    { path: 'acceptance.require_proposal', legacyAccepts: true, mutate: (value) => { value.acceptance.require_proposal = 'yes'; } },
    { path: 'capabilities.authority_ceiling', mutate: (value) => { value.capabilities.authority_ceiling = 'A4'; } },
    { path: 'budgets.max_iterations', mutate: (value) => { value.budgets.max_iterations = 0; } },
    { path: 'budgets.max_wall_clock_ms', mutate: (value) => { value.budgets.max_wall_clock_ms = 0; } },
    { path: 'budgets.max_failed_candidates', mutate: (value) => { value.budgets.max_failed_candidates = 0; } },
    { path: 'budgets.max_consecutive_no_improvement', mutate: (value) => { value.budgets.max_consecutive_no_improvement = 0; } },
    { path: 'budgets.max_tokens', mutate: (value) => { value.budgets.max_tokens = 0; } },
    { path: 'budgets.max_usd', mutate: (value) => { value.budgets.max_usd = -1; } },
  ];

  for (const item of cases) {
    const value = templateContract();
    item.mutate(value);
    const report = contractReport(value);
    assert.equal(report.valid, false, `${item.path} mutation must be rejected`);
    assert.ok(
      report.rejected_fields.some((issue) => issue.path === item.path),
      `${item.path} must be reported, got ${JSON.stringify(report.rejected_fields)}`,
    );
    if (item.code) {
      assert.ok(report.rejected_fields.some((issue) => issue.path === item.path && issue.code === item.code));
    }
    if (item.legacyAccepts) {
      // 0.3.0 read this key but never validated it (`docs/refactor-inventory.md` §5.2 dead keys).
      // v2 type-checks it because the schema declares it; the values that matter are unchanged.
      assert.doesNotThrow(() => validateContract(value));
    } else {
      assert.throws(() => validateContract(value), /./, `0.3.0 validateContract must reject the ${item.path} mutation`);
    }
  }
});

test('config.yaml is validated against the shipped adapter contract', () => {
  const valid = validateDocument('config', parseYamlText(CONFIG_TEXT, 'config.yaml'), '<fixture>/.evofence/config.yaml');
  assert.equal(valid.valid, true, JSON.stringify(valid.rejected_fields));
  assert.ok(valid.accepted_fields.includes('adapters.codex.command'));

  const cases = [
    { mutate: (value) => { value.version = 2; }, path: 'version', code: 'INVALID_CONFIG' },
    { mutate: (value) => { value.logger = 'debug'; }, path: 'logger' },
    { mutate: (value) => { value.adapters.gemini = {}; }, path: 'adapters.gemini' },
    { mutate: (value) => { value.adapters.pi.agent = 'reviewer'; }, path: 'adapters.pi.agent' },
    { mutate: (value) => { value.adapters.codex.model = 5; }, path: 'adapters.codex.model' },
    { mutate: (value) => { value.adapters.claude.command = '  '; }, path: 'adapters.claude.command' },
  ];
  for (const item of cases) {
    const value = parseYamlText(CONFIG_TEXT, 'config.yaml');
    item.mutate(value);
    const report = validateDocument('config', value, '<fixture>/.evofence/config.yaml');
    assert.equal(report.valid, false, `${item.path} mutation must be rejected`);
    assert.ok(report.rejected_fields.some((issue) => issue.path === item.path), `${item.path} must be reported`);
    if (item.code) assert.ok(report.rejected_fields.some((issue) => issue.path === item.path && issue.code === item.code));
  }
});

test('a non-object document is rejected with the document default code', () => {
  const report = validateDocument('contract', ['not', 'an', 'object'], '<fixture>/contract.yaml');
  assert.equal(report.valid, false);
  assert.deepEqual(report.rejected_fields.map((issue) => issue.path), ['<document>']);
  assert.equal(report.rejected_fields[0].code, 'INVALID_CONTRACT');
});

/* ------------------------------------------------------------------ *
 * 3. CLI wiring: exit codes and listed field names (DoD 1/2/3)
 * ------------------------------------------------------------------ */

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function spawnCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
}

async function makeRepo(label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `evofence-config-${label}-`));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'EvoFence Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(root, 'README.md'), '# fixture repository\n');
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'fixture']);
  const init = spawnCli(['init'], root);
  assert.equal(init.status, 0, `init must accept its own scaffolding: ${init.stderr}`);
  return { directory, root };
}

async function writeContract(root, mutate) {
  const contract = templateContract();
  mutate(contract);
  await writeFile(path.join(root, '.evofence', 'contract.yaml'), stringify(contract), 'utf8');
}

test('CLI status exits 0 for a valid config and echoes the configured values', async () => {
  const { directory, root } = await makeRepo('valid');
  try {
    await writeContract(root, (contract) => {
      contract.objective.name = 'io_config_probe';
      contract.objective.direction = 'minimize';
      contract.objective.min_delta = 0.5;
      contract.budgets.max_iterations = 7;
    });

    const result = spawnCli(['status'], root);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('contract=io_config_probe'), result.stdout);
    assert.ok(result.stdout.includes('direction=minimize'), result.stdout);
    assert.ok(result.stdout.includes('min_delta=0.5'), result.stdout);
    assert.ok(result.stdout.includes('max_iterations=7'), result.stdout);

    const json = spawnCli(['status', '--json'], root);
    assert.equal(json.status, 0, json.stderr);
    const status = JSON.parse(json.stdout);
    assert.equal(status.policy.contract.objective.name, 'io_config_probe');
    assert.equal(status.policy.contract.objective.direction, 'minimize');
    assert.equal(status.policy.contract.objective.min_delta, 0.5);
    assert.equal(status.policy.contract.budgets.max_iterations, 7);
    assert.equal(status.policy.files.contract, '.evofence/contract.yaml');
    assert.deepEqual(status.policy.adapters.map((adapter) => adapter.name), ['codex', 'opencode', 'claude', 'pi']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI status exits non-zero and lists rejected field names for unknown keys', async () => {
  const { directory, root } = await makeRepo('unknown');
  try {
    await writeContract(root, (contract) => {
      contract.mystery_knob = true;
      contract.objective.metric = 'score';
    });

    const result = spawnCli(['status'], root);
    assert.notEqual(result.status, 0, `status must fail closed:\n${result.stdout}`);
    assert.ok(result.stderr.includes('rejected field(s):'), result.stderr);
    assert.ok(result.stderr.includes('mystery_knob'), result.stderr);
    assert.ok(result.stderr.includes('objective.metric'), result.stderr);
    // `cli.js` wraps any `buildStatus` failure as LEDGER_UNAVAILABLE (see the cross-domain
    // note in the report); the rejected paths above are what this node guarantees.
    assert.ok(/INVALID_CONTRACT|LEDGER_UNAVAILABLE/.test(result.stderr), result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI status exits non-zero and lists missing required fields', async () => {
  const { directory, root } = await makeRepo('missing');
  try {
    await writeContract(root, (contract) => {
      delete contract.acceptance;
      delete contract.budgets.max_iterations;
    });

    const result = spawnCli(['status'], root);
    assert.notEqual(result.status, 0, `status must fail closed:\n${result.stdout}`);
    assert.ok(result.stderr.includes('missing field(s):'), result.stderr);
    assert.ok(result.stderr.includes('acceptance'), result.stderr);
    assert.ok(result.stderr.includes('budgets.max_iterations'), result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI status reports the raw INVALID_CONFIG/INVALID_CONTRACT code when it is not wrapped by the ledger read', async () => {
  // No `evofence init`, so no ledger: `commandStatus` takes the `emptyStatus` branch, which
  // samples the policy synchronously and is NOT inside the ledger-read try/catch.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-config-noledger-'));
  const root = path.join(directory, 'repo');
  try {
    await mkdir(path.join(root, '.evofence'), { recursive: true });
    runGit(root, ['init', '--quiet', '--initial-branch=main']);
    const contract = templateContract();
    contract.mystery_knob = true;
    await writeFile(path.join(root, '.evofence', 'contract.yaml'), stringify(contract), 'utf8');

    const result = spawnCli(['status'], root);
    assert.notEqual(result.status, 0, `status must fail closed:\n${result.stdout}`);
    assert.ok(result.stderr.includes('[INVALID_CONTRACT]'), result.stderr);
    assert.ok(result.stderr.includes('mystery_knob'), result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI status rejects unknown fields in config.yaml as well', async () => {
  const { directory, root } = await makeRepo('config-unknown');
  try {
    await writeFile(path.join(root, '.evofence', 'config.yaml'), `${CONFIG_TEXT}shady_option: true\n`, 'utf8');
    const result = spawnCli(['status'], root);
    assert.notEqual(result.status, 0, `status must fail closed:\n${result.stdout}`);
    assert.ok(result.stderr.includes('shady_option'), result.stderr);
    assert.ok(result.stderr.includes('rejected field(s):'), result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI status tolerates ONLY the two defaulted fields being absent', async () => {
  const { directory, root } = await makeRepo('defaults');
  try {
    await writeContract(root, (contract) => {
      delete contract.evidence.per_command_timeout_ms;
      delete contract.evidence.max_output_bytes;
    });
    const defaultsOnly = spawnCli(['status'], root);
    assert.equal(defaultsOnly.status, 0, defaultsOnly.stderr);

    await writeContract(root, (contract) => {
      delete contract.budgets.max_tokens;
    });
    const noDefault = spawnCli(['status'], root);
    assert.notEqual(noDefault.status, 0, `budgets.max_tokens must not be defaulted:\n${noDefault.stdout}`);
    assert.ok(noDefault.stderr.includes('budgets.max_tokens'), noDefault.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('evofence init refuses to leave a repository its own validator would reject', async () => {
  const { directory, root } = await makeRepo('init-existing');
  try {
    // The shipped templates must pass v2 unchanged; `makeRepo` already asserted init exit 0.
    const status = spawnCli(['status'], root);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes('Policy: contract=project_improvement'), status.stdout);

    // A pre-existing, hand-broken contract must fail the second init instead of being ignored.
    await writeContract(root, (contract) => { contract.unknown_key = 1; });
    const init = spawnCli(['init'], root);
    assert.notEqual(init.status, 0, `init must fail closed on a broken contract:\n${init.stdout}`);
    assert.ok(init.stderr.includes('[INVALID_CONTRACT]'), init.stderr);
    assert.ok(init.stderr.includes('unknown_key'), init.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the config schema itself is closed over the four shipped adapters', () => {
  assert.deepEqual(Object.keys(CONFIG_SCHEMA.fields ?? {}).sort(), ['adapters', 'version']);
  assert.deepEqual(Object.keys(CONFIG_SCHEMA.fields.adapters.fields).sort(), ['claude', 'codex', 'opencode', 'pi']);
});

/* ------------------------------------------------------------------ *
 * 4. the loader the run path is meant to adopt (exec-domain handoff)
 * ------------------------------------------------------------------ */

test('the required-config loader preserves MISSING_FILE and fails closed on invalid input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-config-required-'));
  const root = path.join(directory, 'repo');
  try {
    await mkdir(path.join(root, '.evofence'), { recursive: true });

    assert.throws(
      () => loadRequiredConfigDocumentSync(root),
      (error) => error?.code === 'MISSING_FILE',
      'a missing config.yaml must keep the 0.3.0 MISSING_FILE identity',
    );

    await writeFile(path.join(root, '.evofence', 'config.yaml'), `${CONFIG_TEXT}shady_option: true
`, 'utf8');
    assert.throws(
      () => loadRequiredConfigDocumentSync(root),
      (error) => error?.code === 'INVALID_CONFIG',
      'an unknown key must fail closed',
    );

    await writeFile(path.join(root, '.evofence', 'config.yaml'), CONFIG_TEXT, 'utf8');
    const config = loadRequiredConfigDocumentSync(root);
    assert.equal(config.version, 1);
    assert.equal(config.adapters.codex.command, 'codex');
    assert.equal(config.adapters.pi.command, 'pi');
    assert.equal(config.adapters.pi.model, null);
    assert.equal(config.adapters.pi.agent, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the required-contract loader preserves MISSING_FILE and returns the two defaults applied', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-config-required-contract-'));
  const root = path.join(directory, 'repo');
  try {
    await mkdir(path.join(root, '.evofence'), { recursive: true });

    assert.throws(
      () => loadRequiredContractDocumentSync(root),
      (error) => error?.code === 'MISSING_FILE',
    );

    const contract = templateContract();
    delete contract.evidence.per_command_timeout_ms;
    delete contract.evidence.max_output_bytes;
    await writeFile(path.join(root, '.evofence', 'contract.yaml'), stringify(contract), 'utf8');

    const loaded = loadRequiredContractDocumentSync(root);
    assert.equal(loaded.objective.name, contract.objective.name);
    assert.equal(loaded.evidence.per_command_timeout_ms, CONTRACT_DEFAULTS['evidence.per_command_timeout_ms']);
    assert.equal(loaded.evidence.max_output_bytes, CONTRACT_DEFAULTS['evidence.max_output_bytes']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
