import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeRepository } from '../dist/lib/init.js';
import { Ledger, ledgerPath } from '../dist/lib/ledger.js';

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
  await writeFile(path.join(root, 'goal.md'), 'doctor proof fixture\n');
  return { directory, root };
}

function spawnDoctor(args, cwd) {
  return spawnSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function spawnRun(cwd, adapter = 'codex') {
  return spawnSync(process.execPath, [CLI, 'run', '--json', '--adapter', adapter, '--goal', 'goal.md'], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
  });
}

async function directoryInventory(root) {
  const directories = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(current, entry.name);
      directories.push(path.relative(root, child));
      await visit(child);
    }
  }
  await visit(root);
  return directories.sort();
}

async function assertDoctorMatchesRun(configure, checkId, adapter = 'codex') {
  const { directory, root } = await makeRepo();
  try {
    await configure(root);
    const doctor = spawnDoctor(['--adapter', adapter, '--json'], root);
    assert.equal(doctor.status, 1, doctor.stderr);
    const document = JSON.parse(doctor.stdout);
    const refused = document.checks.filter((check) => check.status === 'refused');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].id, checkId);

    const run = spawnRun(root, adapter);
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(run.stderr).error.code, refused[0].code);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    const run = spawnRun(root);
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(run.stderr).error.code, check.code);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor does not change git, ledger, worktrees, or directories', async () => {
  const { directory, root } = await makeRepo();
  try {
    const ledgerFile = ledgerPath(root);
    const before = {
      status: spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout,
      worktrees: spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout,
      directories: await directoryInventory(root),
      ledger: await readFile(ledgerFile),
      ledgerStat: await stat(ledgerFile),
    };
    const result = spawnDoctor(['--json'], root);
    assert.equal(result.status, 0, result.stderr);
    const after = {
      status: spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout,
      worktrees: spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout,
      directories: await directoryInventory(root),
      ledger: await readFile(ledgerFile),
      ledgerStat: await stat(ledgerFile),
    };
    assert.equal(after.status, before.status);
    assert.equal(after.worktrees, before.worktrees);
    assert.deepEqual(after.directories, before.directories);
    assert.deepEqual(after.ledger, before.ledger);
    assert.equal(after.ledgerStat.size, before.ledgerStat.size);
    assert.equal(after.ledgerStat.mtimeMs, before.ledgerStat.mtimeMs);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor and run agree on an evidence refusal', async () => {
  await assertDoctorMatchesRun(async (root) => {
    const file = path.join(root, '.evofence', 'contract.yaml');
    const contract = await readFile(file, 'utf8');
    await writeFile(file, contract.replace('public_commands:\n    - "node --version"', 'public_commands: []'));
  }, 'evidence-config');
});

test('doctor and run agree on a holdout refusal', async () => {
  await assertDoctorMatchesRun(async (root) => {
    await writeFile(path.join(root, '.evofence', 'private', 'holdout.yaml'), 'regressions:\n  - id: hidden\n    command: "node --version"\n');
  }, 'holdout-exposure');
});

test('doctor and run agree on an adapter budget refusal', async () => {
  await assertDoctorMatchesRun(async (root) => {
    const file = path.join(root, '.evofence', 'contract.yaml');
    const contract = await readFile(file, 'utf8');
    await writeFile(file, contract.replace('max_usd: null', 'max_usd: 1.0'));
  }, 'budget-adapter');
});

test('doctor and run agree on Pi max_usd preflight ordering', async () => {
  await assertDoctorMatchesRun(async (root) => {
    const file = path.join(root, '.evofence', 'contract.yaml');
    const contract = await readFile(file, 'utf8');
    await writeFile(file, contract.replace('max_usd: null', 'max_usd: 1.0'));
  }, 'budget-adapter', 'pi');
});

test('doctor and run agree on an adapter isolation refusal', async () => {
  await assertDoctorMatchesRun(async () => {}, 'budget-adapter', 'claude');
});

test('doctor and run agree on a ledger refusal', async () => {
  await assertDoctorMatchesRun(async (root) => {
    const ledger = new Ledger(ledgerPath(root));
    try {
      ledger.append('run.started', 'run-doctor', { adapter: 'codex' });
    } finally {
      ledger.close();
    }
    const tampered = new Ledger(ledgerPath(root));
    try {
      tampered.db.exec('DROP TRIGGER IF EXISTS events_no_update');
      tampered.db.prepare('UPDATE events SET payload_json = ? WHERE seq = 1').run('{"adapter":"tampered"}');
    } finally {
      tampered.close();
    }
  }, 'ledger-integrity');
});
