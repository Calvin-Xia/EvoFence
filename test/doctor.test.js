import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runAgentAdapter } from '../dist/lib/adapter.js';
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

function doctorFailure(result) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const payload = JSON.parse(result.stderr);
  assert.deepEqual(Object.keys(payload), ['error']);
  assert.ok(Array.isArray(payload.error.details.checks));
  return payload.error;
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
    const error = doctorFailure(doctor);
    const refused = error.details.checks.filter((check) => check.status === 'refused');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].id, checkId);
    assert.equal(error.code, refused[0].code);

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
    const error = doctorFailure(result);
    const check = error.details.checks.find((item) => item.id === 'contract-config');
    assert.equal(check.status, 'refused');
    assert.equal(check.code, 'INVALID_CONFIG');
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

test('doctor JSON refusals use the CLI failure envelope', async () => {
  const { directory, root } = await makeRepo();
  try {
    await writeFile(path.join(root, '.evofence', 'private', 'holdout.yaml'), 'regressions:\n  - id: hidden\n    command: "node --version"\n');
    const error = doctorFailure(spawnDoctor(['--json'], root));
    assert.equal(error.code, 'PRIVATE_ORACLE_READABLE');
    assert.equal(error.message, 'Doctor preflight refused.');
    const check = error.details.checks.find((item) => item.id === 'holdout-exposure');
    assert.deepEqual(check, {
      id: 'holdout-exposure',
      label: 'Private holdout exposure',
      status: 'refused',
      code: 'PRIVATE_ORACLE_READABLE',
      remediation: 'Keep .evofence/private/holdout.yaml excluded from Git; pass --allow-readable-holdout only if you accept possible oracle exposure, or use a container or VM with restricted mounts.',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor and run agree when the private holdout is not ignored', async () => {
  await assertDoctorMatchesRun(async (root) => {
    const emptyGlobalExcludes = path.join(root, 'empty-global-excludes');
    await writeFile(emptyGlobalExcludes, '');
    runGit(root, ['config', 'core.excludesFile', emptyGlobalExcludes]);
    await writeFile(path.join(root, '.gitignore'), '');
    await writeFile(path.join(root, '.evofence', '.gitignore'), '');
    await writeFile(path.join(root, '.evofence', 'private', 'holdout.yaml'), 'regressions: []\n');
  }, 'holdout-exposure');
});

test('doctor --fix adds the holdout ignore entry, rechecks it, and is idempotent', async () => {
  const { directory, root } = await makeRepo();
  try {
    const emptyGlobalExcludes = path.join(root, 'empty-global-excludes');
    await writeFile(emptyGlobalExcludes, '');
    runGit(root, ['config', 'core.excludesFile', emptyGlobalExcludes]);
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    await writeFile(path.join(root, '.evofence', '.gitignore'), '');
    await writeFile(path.join(root, '.evofence', 'private', 'holdout.yaml'), 'regressions: []\n');

    const first = spawnDoctor(['--fix', '--json'], root);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stderr, '');
    const firstDocument = JSON.parse(first.stdout);
    const firstCheck = firstDocument.checks.find((item) => item.id === 'holdout-exposure');
    assert.equal(firstCheck.status, 'ok');
    assert.deepEqual(firstCheck.action, {
      status: 'fixed',
      message: 'Added .evofence/private/holdout.yaml to .gitignore; rechecked Git ignore status.',
      original_code: 'HOLDOUT_NOT_IGNORED',
    });
    assert.equal(spawnSync('git', ['check-ignore', '-q', path.join(root, '.evofence', 'private', 'holdout.yaml')], { cwd: root }).status, 0);

    const second = spawnDoctor(['--fix', '--json'], root);
    assert.equal(second.status, 0, second.stderr);
    const secondCheck = JSON.parse(second.stdout).checks.find((item) => item.id === 'holdout-exposure');
    assert.deepEqual(secondCheck.action, { status: 'not-needed', message: 'No action required.' });
    const ignoreFile = await readFile(path.join(root, '.gitignore'), 'utf8');
    assert.equal(ignoreFile.split('\n').filter((line) => line === '.evofence/private/holdout.yaml').length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor --fix restores .gitignore when the post-fix ignore check fails', async () => {
  const { directory, root } = await makeRepo();
  try {
    const emptyGlobalExcludes = path.join(root, 'empty-global-excludes');
    await writeFile(emptyGlobalExcludes, '');
    runGit(root, ['config', 'core.excludesFile', emptyGlobalExcludes]);
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    await writeFile(path.join(root, '.evofence', '.gitignore'), '');
    const holdout = path.join(root, '.evofence', 'private', 'holdout.yaml');
    await writeFile(holdout, 'regressions: []\n');
    runGit(root, ['add', holdout]);
    const original = await readFile(path.join(root, '.gitignore'), 'utf8');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = doctorFailure(spawnDoctor(['--fix', '--json'], root));
      const check = error.details.checks.find((item) => item.id === 'holdout-exposure');
      assert.equal(check.action.status, 'unfixable');
      assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), original);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor --fix refuses a hard-linked .gitignore without changing the shared target', async () => {
  const { directory, root } = await makeRepo();
  try {
    const emptyGlobalExcludes = path.join(root, 'empty-global-excludes');
    await writeFile(emptyGlobalExcludes, '');
    runGit(root, ['config', 'core.excludesFile', emptyGlobalExcludes]);
    await writeFile(path.join(root, '.evofence', '.gitignore'), '');
    await writeFile(path.join(root, '.evofence', 'private', 'holdout.yaml'), 'regressions: []\n');

    const gitignore = path.join(root, '.gitignore');
    const contract = path.join(root, '.evofence', 'contract.yaml');
    const contractBefore = await readFile(contract, 'utf8');
    await rm(gitignore, { force: true });
    await link(contract, gitignore);

    const error = doctorFailure(spawnDoctor(['--fix', '--json'], root));
    assert.equal(error.code, 'DOCTOR_UNFIXABLE');
    const check = error.details.checks.find((item) => item.id === 'holdout-exposure');
    assert.equal(check.code, 'DOCTOR_UNFIXABLE');
    assert.equal(check.action.status, 'unfixable');
    assert.equal(await readFile(contract, 'utf8'), contractBefore);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor --fix reports unsafe readable holdouts as DOCTOR_UNFIXABLE', async () => {
  const { directory, root } = await makeRepo();
  try {
    await writeFile(path.join(root, '.evofence', 'private', 'holdout.yaml'), 'regressions:\n  - id: hidden\n    command: "node --version"\n');
    const error = doctorFailure(spawnDoctor(['--fix', '--json'], root));
    assert.equal(error.code, 'DOCTOR_UNFIXABLE');
    const check = error.details.checks.find((item) => item.id === 'holdout-exposure');
    assert.equal(check.code, 'DOCTOR_UNFIXABLE');
    assert.deepEqual(check.action, {
      status: 'unfixable',
      message: 'No safe automatic fix for PRIVATE_ORACLE_READABLE.',
      original_code: 'PRIVATE_ORACLE_READABLE',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test('doctor and the adapter guard agree on OpenCode isolation refusal', async () => {
  const { directory, root } = await makeRepo();
  try {
    const error = doctorFailure(spawnDoctor(['--adapter', 'opencode', '--json'], root));
    assert.equal(error.code, 'OPEN_CODE_SANDBOX_REQUIRED');
    assert.equal(error.details.checks.find((item) => item.id === 'budget-adapter').code, error.code);
    await assert.rejects(runAgentAdapter({
      name: 'opencode', command: 'must-not-launch', cwd: root, timeoutMs: 1000, maxOutputBytes: 1000,
    }), { code: error.code });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor rejects an unknown adapter with the adapter guard code', async () => {
  const { directory, root } = await makeRepo();
  try {
    const error = doctorFailure(spawnDoctor(['--adapter', 'not-an-adapter', '--json'], root));
    assert.equal(error.code, 'UNKNOWN_ADAPTER');
    assert.equal(error.details.checks.find((item) => item.id === 'budget-adapter').code, error.code);
    await assert.rejects(runAgentAdapter({
      name: 'not-an-adapter', command: 'must-not-launch', cwd: root, timeoutMs: 1000, maxOutputBytes: 1000,
    }), { code: error.code });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test('doctor reports missing and unreadable ledgers as ledger-integrity refusals', async () => {
  for (const [label, configure] of [
    ['missing', async (root) => { await rm(ledgerPath(root)); }],
    ['not-sqlite', async (root) => { await writeFile(ledgerPath(root), 'not a sqlite database\n'); }],
  ]) {
    const { directory, root } = await makeRepo();
    try {
      await configure(root);
      const error = doctorFailure(spawnDoctor(['--json'], root));
      assert.equal(error.code, 'LEDGER_UNAVAILABLE', label);
      const check = error.details.checks.find((item) => item.id === 'ledger-integrity');
      assert.equal(check.status, 'refused');
      assert.equal(check.code, 'LEDGER_UNAVAILABLE');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
