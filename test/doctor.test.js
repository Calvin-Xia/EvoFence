import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeRepository } from '../dist/lib/init.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function makeRepo() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evofence-doctor-'));
  const root = path.join(directory, 'repo');
  await mkdir(root, { recursive: true });
  runGit(root, ['init', '--quiet', '--initial-branch=main']);
  await initializeRepository(root);
  const contractFile = path.join(root, '.evofence', 'contract.yaml');
  const contract = await readFile(contractFile, 'utf8');
  await writeFile(contractFile, contract
    .replace('command: ""', 'command: "node --version"')
    .replace('public_commands: []', 'public_commands:\n    - "node --version"'));
  return { directory, root };
}

function spawnDoctor(args, cwd) {
  return spawnSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('doctor JSON output exposes all read-only preflight checks', async () => {
  const { directory, root } = await makeRepo();
  try {
    const result = spawnDoctor(['--json'], root);
    assert.equal(result.status, 0, result.stderr);
    const document = JSON.parse(result.stdout);
    assert.deepEqual(document.checks.map((check) => check.id), [
      'contract-config', 'evidence-config', 'holdout-exposure', 'budget-adapter', 'process-tree', 'ledger-integrity',
    ]);
    for (const check of document.checks) {
      assert.deepEqual(Object.keys(check).sort(), ['code', 'id', 'label', 'remediation', 'status']);
      assert.equal(typeof check.id, 'string');
      assert.equal(typeof check.label, 'string');
      assert.equal(check.status, 'ok');
      assert.equal(check.code, null);
      assert.equal(check.remediation, 'No action required.');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor text output is one readable line per check', async () => {
  const { directory, root } = await makeRepo();
  try {
    const result = spawnDoctor([], root);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 6);
    for (const line of lines) assert.match(line, /^OK [^:]+: .+/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor accepts the shared adapter flag', async () => {
  const { directory, root } = await makeRepo();
  try {
    const result = spawnDoctor(['--adapter=codex', '--json'], root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor preserves the config loader error code', async () => {
  const { directory, root } = await makeRepo();
  try {
    const configFile = path.join(root, '.evofence', 'config.yaml');
    const config = await readFile(configFile, 'utf8');
    await writeFile(configFile, `${config}unknown: refused\n`);
    const result = spawnDoctor(['--json'], root);
    assert.equal(result.status, 1);
    const check = JSON.parse(result.stdout).checks.find((item) => item.id === 'contract-config');
    assert.equal(check.status, 'refused');
    assert.equal(check.code, 'INVALID_CONFIG');
    assert.equal(result.stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
