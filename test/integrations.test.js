import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COMMANDS } from '../dist/lib/cli/catalog.js';
import * as publicApi from '../dist/index.js';
import {
  parseCliFailure as parsePiCliFailure,
  parseCliResult as parsePiCliResult,
  runEvoFence as runPiEvoFence,
} from '../integrations/pi/cli.js';
import {
  parseCliFailure as parseOpenCodeCliFailure,
  parseCliResult as parseOpenCodeCliResult,
  runEvoFence as runOpenCodeEvoFence,
} from '../integrations/opencode/plugins/cli.js';

const root = path.resolve(import.meta.dirname, '..');
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
const exists = (relativePath) => access(path.join(root, relativePath));
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('Codex and Claude marketplaces point to complete, namespaced plugins', async () => {
  const rootPackage = await readJson('package.json');
  const codexMarketplace = await readJson('.agents/plugins/marketplace.json');
  const codexPlugin = codexMarketplace.plugins[0];
  assert.equal(codexPlugin.name, 'evofence');
  assert.equal(codexPlugin.source.path, './integrations/codex');
  const portableCodexManifest = await readJson('integrations/codex/plugin.json');
  assert.equal(portableCodexManifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(portableCodexManifest.name, 'evofence');
  assert.equal(portableCodexManifest.version, rootPackage.version);
  const portablePrompts = portableCodexManifest.extensions['com.openai'].interface.defaultPrompt;
  assert.ok(portablePrompts.length > 0 && portablePrompts.length <= 3);
  assert.ok(portablePrompts.every((prompt) => prompt.length <= 128));
  await exists('integrations/codex/.codex-plugin/plugin.json');
  const codexManifest = await readJson('integrations/codex/.codex-plugin/plugin.json');
  assert.equal(codexManifest.name, 'evofence');
  assert.equal(codexManifest.version, rootPackage.version);
  assert.equal(codexManifest.skills, './skills/');
  assert.deepEqual(codexManifest.interface.defaultPrompt, portablePrompts);
  for (const name of ['inspect-ledger', 'run-evolution']) {
    const skill = await readFile(path.join(root, 'integrations/codex/skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^name: ${name}$`, 'm'));
  }

  const claudeMarketplace = await readJson('.claude-plugin/marketplace.json');
  assert.equal(claudeMarketplace.plugins[0].name, 'evofence');
  assert.equal(claudeMarketplace.metadata.version, rootPackage.version);
  assert.equal(claudeMarketplace.plugins[0].version, rootPackage.version);
  assert.equal(claudeMarketplace.plugins[0].source, './integrations/claude-code');
  await exists('integrations/claude-code/.claude-plugin/plugin.json');
  const claudePlugin = await readJson('integrations/claude-code/.claude-plugin/plugin.json');
  assert.equal(claudePlugin.version, rootPackage.version);
  await exists('integrations/claude-code/commands/inspect-ledger.md');
  await exists('integrations/claude-code/commands/run-evolution.md');
});

test('OpenCode and Pi integration packages declare the modules their extensions import', async () => {
  const opencode = await readJson('integrations/opencode/package.json');
  assert.ok(opencode.dependencies['@opencode-ai/plugin']);
  await exists('integrations/opencode/plugins/evofence.js');

  const pi = await readJson('integrations/pi/package.json');
  assert.ok(pi.dependencies.typebox);
  await exists('integrations/pi/evofence.js');
  await exists('.pi/extensions/evofence.js');
  const piProjectEntry = await readFile(path.join(root, '.pi/extensions/evofence.js'), 'utf8');
  assert.match(piProjectEntry, /export\s+\{\s*default\s*\}\s+from\s+['"]\.\.\/\.\.\/integrations\/pi\/evofence\.js['"]/);
});

const INTEGRATION_DOC_FILES = [
  'integrations/claude-code/README.md',
  'integrations/claude-code/commands/inspect-ledger.md',
  'integrations/claude-code/commands/run-evolution.md',
  'integrations/codex/README.md',
  'integrations/codex/skills/inspect-ledger/SKILL.md',
  'integrations/codex/skills/run-evolution/SKILL.md',
  'integrations/deepseek-harness/README.md',
  'integrations/opencode/README.md',
  'integrations/pi/README.md',
];

const INTEGRATION_COMMAND_FILES = [
  'integrations/claude-code/commands/inspect-ledger.md',
  'integrations/claude-code/commands/run-evolution.md',
  'integrations/codex/skills/inspect-ledger/SKILL.md',
  'integrations/codex/skills/run-evolution/SKILL.md',
  'integrations/opencode/README.md',
];

const INTEGRATION_JS_FILES = ['integrations/pi/evofence.js', 'integrations/opencode/plugins/evofence.js'];
const COMMAND_NAMES = COMMANDS.map((command) => command.name);
const COMMAND_NAMES_BY_LENGTH = [...COMMAND_NAMES].sort((left, right) => right.split(' ').length - left.split(' ').length);

const COMMAND_COVERAGE_ALLOWLIST = new Map([
  ['init', 'Host integrations must not initialize control-plane state.'],
  ['proposal inspect', 'Proposal payload inspection is a CLI control-plane surface, not a host tool.'],
  ['evidence run', 'Candidate evidence execution is an EvoFence control-plane operation, not a host read tool.'],
  ['gate', 'Gate evaluation is a control-plane decision surface and is not dispatched by a host integration.'],
  ['ledger show', 'The command exposes complete event payloads, which violates the host integrations privacy boundary.'],
  ['ledger export', 'Export writes a bundle and is intentionally kept as an explicit CLI operation.'],
  ['diff', 'Generation diffs can expose candidate evidence and remain a CLI-only audit surface.'],
  ['rollback', 'Rollback mutates the active-generation ref and is never a host integration action.'],
  ['experiment run', 'Experiment execution is a CLI control-plane operation, not a host integration action.'],
  ['experiment export', 'Experiment export writes a file and remains an explicit CLI operation.'],
  ['report', 'Cross-run report serialization is CLI-only; host integrations expose only their minimal sanitized ledger/run surfaces.'],
  ['budget', 'Historical budget forecasting is CLI-only and must not be presented as host-side enforcement.'],
  ['status', 'The operational status view is CLI-only; host integrations expose targeted read-only checks instead.'],
]);

const REQUIRED_NEW_SURFACES = ['report --format', 'doctor --fix', 'budget'];

const NEW_SURFACE_COVERAGE = [
  {
    surface: 'report --format',
    command: 'report',
    flag: 'format',
    coveredBy: [],
    allowlistReason: 'No host integration renders cross-run text/JSON/SARIF/JUnit reports; this remains an explicit CLI output surface.',
  },
  {
    surface: 'doctor --fix',
    command: 'doctor',
    flag: 'fix',
    coveredBy: [],
    allowlistReason: 'All host doctor integrations are strictly read-only; they must not expose a mutating remediation flag.',
  },
  {
    surface: 'budget',
    command: 'budget',
    flag: null,
    coveredBy: [],
    allowlistReason: 'The deterministic historical-mean forecast is a CLI control-plane view, not a host adapter capability.',
  },
];

function commandSpec(name) {
  return COMMANDS.find((command) => command.name === name);
}

function parseInvocation(tokens, file) {
  const name = COMMAND_NAMES_BY_LENGTH.find((candidate) => {
    const words = candidate.split(' ');
    return words.every((word, index) => tokens[index] === word);
  });
  const command = name === undefined ? undefined : commandSpec(name);
  const argumentsStart = name === undefined ? 0 : name.split(' ').length;
  const flags = [];
  const positionals = [];
  for (let index = argumentsStart; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('--')) {
      const flag = token.slice(2).split('=')[0];
      flags.push(flag);
      const declaration = command === undefined ? undefined : command.flags.find((candidate) => candidate.name === flag);
      if (!token.includes('=') && declaration !== undefined && declaration.kind === 'value') index += 1;
      continue;
    }
    if (!token.startsWith('<')) positionals.push(token);
  }
  return { file, name, flags, positionals, tokens };
}

function parseMarkdownInvocations(text, file) {
  return text.split(/\r?\n/).flatMap((line) => [...line.matchAll(/evofence\s+[^`]+/g)].map((match) => {
    const tokens = match[0].trim().replace(/[.,;:]$/, '').split(/\s+/);
    return parseInvocation(tokens.slice(1), file);
  }));
}

function parseJavaScriptInvocations(text, file) {
  const arrayPattern = /\[((?:\s*'[^']*'\s*,?|\s*[A-Za-z_$][A-Za-z0-9_$]*\s*,?)+)\]/g;
  return [...text.matchAll(arrayPattern)].map((match) => {
    const tokens = [...match[1].matchAll(/'([^']*)'|([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((token) => token[1] === undefined ? token[2] : token[1]);
    return parseInvocation(tokens, file);
  });
}

async function loadIntegrationInvocations() {
  const docs = await Promise.all(INTEGRATION_DOC_FILES.map(async (file) => [file, await read(file)]));
  const scripts = await Promise.all(INTEGRATION_JS_FILES.map(async (file) => [file, await read(file)]));
  return [
    ...docs.flatMap(([file, text]) => parseMarkdownInvocations(text, file)),
    ...scripts.flatMap(([file, text]) => parseJavaScriptInvocations(text, file)),
  ];
}

function assertCommandClosure(invocations) {
  for (const invocation of invocations) {
    assert.ok(invocation.name, invocation.file + ' contains an unparseable EvoFence command: ' + invocation.tokens.join(' '));
    assert.ok(commandSpec(invocation.name), invocation.file + ' invokes "' + invocation.name + '", which is not in the command catalog');
  }
}

function assertFlagClosure(invocations) {
  for (const invocation of invocations) {
    const command = commandSpec(invocation.name);
    assert.ok(command, invocation.file + ' must resolve a catalog command before checking flags');
    const allowedFlags = new Set(command.flags.map((flag) => flag.name));
    for (const flag of invocation.flags) {
      assert.ok(allowedFlags.has(flag), invocation.file + ' invokes ' + invocation.name + ' with --' + flag + ', which is not declared by that command');
    }
  }
}

function assertPositionalContracts(invocations) {
  for (const invocation of invocations) {
    const command = commandSpec(invocation.name);
    assert.ok(command, invocation.file + ' must resolve a catalog command before checking positionals');
    for (const positional of command.positionals) {
      const range = positional.description === undefined ? null : positional.description.match(/(\d+)\.\.(\d+)/);
      if (range === null || invocation.positionals.length === 0) continue;
      const value = Number(invocation.positionals[0]);
      assert.ok(Number.isInteger(value) && value >= Number(range[1]) && value <= Number(range[2]), invocation.file + ' invokes ' + invocation.name + ' with ' + invocation.positionals[0] + ', outside ' + range[1] + '..' + range[2]);
    }
  }
}

function assertDirectoryCoverage(invocations) {
  for (const [name, reason] of COMMAND_COVERAGE_ALLOWLIST) {
    assert.ok(commandSpec(name), 'coverage allowlist names unknown command ' + name);
    assert.ok(reason.length > 0, 'coverage allowlist needs a reason for ' + name);
  }
  const coveredCommands = new Set(invocations.map((invocation) => invocation.name));
  for (const command of COMMANDS) {
    if (COMMAND_COVERAGE_ALLOWLIST.has(command.name)) continue;
    assert.ok(coveredCommands.has(command.name), command.name + ' is in the CLI catalog but has no host integration coverage');
  }
}

function coverageFilesByCommand(invocations) {
  const files = new Map();
  for (const invocation of invocations) {
    if (invocation.name === undefined) continue;
    if (COMMAND_COVERAGE_ALLOWLIST.has(invocation.name)) continue;
    if (!files.has(invocation.name)) files.set(invocation.name, new Set());
    files.get(invocation.name).add(invocation.file);
  }
  return Object.fromEntries([...files].map(([name, commandFiles]) => [name, [...commandFiles].sort()]));
}

function assertNewSurfaceCoverage(entries = NEW_SURFACE_COVERAGE) {
  const requiredSurfaces = REQUIRED_NEW_SURFACES;
  assert.deepEqual(entries.map((entry) => entry.surface).sort(), requiredSurfaces.sort(), 'new CLI surfaces need an explicit coverage entry');
  for (const entry of entries) {
    const command = commandSpec(entry.command);
    assert.ok(command, entry.surface + ' names an unknown command');
    if (entry.flag !== null) assert.ok(command.flags.some((flag) => flag.name === entry.flag), entry.surface + ' names an unknown flag');
    assert.ok(entry.coveredBy.length > 0 || entry.allowlistReason.length > 0, entry.surface + ' needs an integration or a concrete allowlist reason');
  }
}

function legacyCommandNameGuard(invocations) {
  const catalogNames = new Set(COMMAND_NAMES);
  for (const invocation of invocations) assert.ok(catalogNames.has(invocation.name), invocation.file + ' invokes ' + invocation.name);
}

test('pre-upgrade guard evidence: flag and numeric-argument drift passed the old command-name check', async () => {
  const flagDrift = parseMarkdownInvocations('evofence ledger verify --not-a-catalog-flag', 'synthetic-flag-drift.md');
  const piSource = await read('integrations/pi/evofence.js');
  const numericSource = piSource.replace("['ledger', 'recent', '10']", "['ledger', 'recent', '999']");
  assert.notEqual(numericSource, piSource, 'the numeric drift fixture must change the integration source');
  const numericDrift = parseJavaScriptInvocations(numericSource, 'synthetic-pi-drift.js').filter((invocation) => invocation.name === 'ledger recent');
  assert.equal(numericDrift.length, 1);
  assert.doesNotThrow(() => legacyCommandNameGuard([...flagDrift, ...numericDrift]));
  console.log(JSON.stringify({ preUpgradeGuard: 'passed', flagDrift: '--not-a-catalog-flag', numericDrift: 'ledger recent 999' }));
});

test('host guard command-name closure covers all scanned integration invocations', async () => {
  const invocations = await loadIntegrationInvocations();
  assertCommandClosure(invocations);
});

test('host guard flag closure and positional contracts are independent and strict', async () => {
  const invocations = await loadIntegrationInvocations();
  assertFlagClosure(invocations);
  assertPositionalContracts(invocations);

  const flagDrift = parseMarkdownInvocations('evofence ledger verify --not-a-catalog-flag', 'synthetic-flag-drift.md');
  assert.throws(() => assertFlagClosure(flagDrift), /not declared by that command/);

  const piSource = await read('integrations/pi/evofence.js');
  const numericSource = piSource.replace("['ledger', 'recent', '10']", "['ledger', 'recent', '999']");
  const numericDrift = parseJavaScriptInvocations(numericSource, 'synthetic-pi-drift.js').filter((invocation) => invocation.name === 'ledger recent');
  assert.throws(() => assertPositionalContracts(numericDrift), /outside 1\.\.20/);
});

test('host guard directory coverage and new-surface coverage are explicit', async () => {
  const actualDocFiles = (await readdir(path.join(root, 'integrations'), { recursive: true }))
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replaceAll('\\', '/').replace(/^/, 'integrations/'))
    .sort();
  assert.deepEqual(actualDocFiles, [...INTEGRATION_DOC_FILES].sort(), 'the guard must scan every integration Markdown document');
  const invocations = await loadIntegrationInvocations();
  assertDirectoryCoverage(invocations);
  assertNewSurfaceCoverage();
  console.log(JSON.stringify({
    scannedMarkdownFiles: INTEGRATION_DOC_FILES,
    coverageByCommand: coverageFilesByCommand(invocations),
    newSurfaces: NEW_SURFACE_COVERAGE.map(({ surface, coveredBy, allowlistReason }) => ({ surface, coveredBy, allowlistReason })),
    coverageAllowlist: [...COMMAND_COVERAGE_ALLOWLIST],
  }));
});

test('host guard turns red when a command, flag, or new-surface coverage reference is removed', async () => {
  const inspectFile = 'integrations/claude-code/commands/inspect-ledger.md';
  const inspectSource = await read(inspectFile);
  const removedCommandReference = inspectSource.replace('evofence ledger verify', 'evofence ledger verifier');
  assert.throws(() => assertCommandClosure(parseMarkdownInvocations(removedCommandReference, inspectFile)), /unparseable|not in the command catalog/);

  const removedFlagReference = inspectSource.replace('--json', '--not-a-catalog-flag');
  assert.throws(() => assertFlagClosure(parseMarkdownInvocations(removedFlagReference, inspectFile)), /not declared by that command/);

  const removedNewSurfaceCoverage = NEW_SURFACE_COVERAGE.filter((entry) => entry.surface !== 'report --format');
  assert.throws(() => assertNewSurfaceCoverage(removedNewSurfaceCoverage), /new CLI surfaces need an explicit coverage entry/);
  console.log(JSON.stringify({ removedCommandReference: 'red', removedFlagReference: 'red', removedNewSurfaceCoverage: 'red' }));
});

test('every EvoFence CLI invocation shipped with an integration exists in the command catalog', async () => {
  const catalogNames = new Set(COMMANDS.map((command) => command.name));
  const invocation = /evofence ([a-z][a-z-]*)( [a-z][a-z-]*)?/g;
  for (const file of INTEGRATION_COMMAND_FILES) {
    const text = await read(file);
    const referenced = [...text.matchAll(invocation)].map((match) => (match[2] ? `${match[1]} ${match[2].trim()}` : match[1]));
    assert.ok(referenced.length > 0, `${file} references no EvoFence command`);
    for (const name of new Set(referenced)) {
      assert.ok(catalogNames.has(name), `${file} invokes "${name}", which is not in the command catalog`);
    }
  }

  // The two JS plugins build argv arrays directly instead of quoting a command line.
  for (const file of ['integrations/pi/evofence.js', 'integrations/opencode/plugins/evofence.js']) {
    const source = await read(file);
    const argv = [...source.matchAll(/\['([a-z-]+)', '([a-z-]+)'(?:, '([0-9]+)')?\]/g)].map((match) => `${match[1]} ${match[2]}`);
    assert.deepEqual(new Set(argv), new Set(['ledger verify', 'ledger recent']), `${file} must read the ledger through the catalog commands`);
    for (const name of argv) assert.ok(catalogNames.has(name), `${file} runs "${name}", which is not in the command catalog`);
  }

  // The one library consumer pins the package whose public API it imports.
  const rootPackage = await readJson('package.json');
  const harness = await readJson('integrations/deepseek-harness/package.json');
  assert.equal(harness.dependencies.evofence, rootPackage.version);
  const harnessReadme = await read('integrations/deepseek-harness/README.md');
  assert.ok(harnessReadme.includes(`evofence@${rootPackage.version}`), 'the harness README must document the pinned package version');
});

test('all five host integrations expose the read-only doctor preflight', async () => {
  const doctor = COMMANDS.find((command) => command.name === 'doctor');
  assert.ok(doctor, 'doctor must remain in the CLI catalog');
  assert.equal(doctor.usage, 'doctor [--adapter <name>] [--fix] [--json]');

  const files = [
    'integrations/claude-code/commands/run-evolution.md',
    'integrations/codex/skills/run-evolution/SKILL.md',
    'integrations/pi/evofence.js',
    'integrations/opencode/plugins/evofence.js',
    'integrations/deepseek-harness/README.md',
  ];
  for (const file of files) {
    const source = await read(file);
    assert.match(source, /evofence doctor/, `${file} must expose the doctor command`);
    assert.match(source, /--json/, `${file} must request the machine-readable doctor result`);
  }

  const claudeRun = await read(files[0]);
  const codexRun = await read(files[1]);
  assert.ok(claudeRun.indexOf('evofence doctor') < claudeRun.indexOf('evofence run'), 'Claude must preflight before run');
  assert.ok(codexRun.indexOf('evofence doctor') < codexRun.indexOf('evofence run'), 'Codex must preflight before run');
  assert.match(claudeRun, /non-zero exit[^.]*refus/i);
  assert.match(codexRun, /non-zero exit[^.]*refusal/i);
  assert.match(await read(files[2]), /registerCommand\('evofence-doctor'/);
  assert.match(await read(files[2]), /name: 'evofence_doctor'/);
  assert.match(await read(files[3]), /evofence_doctor/);
  assert.match(await read(files[4]), /Preflight is outside this library surface/);
});

test('the public package API adds verifyBundle without changing existing export shapes', () => {
  const existing = [
    'initializeRepository', 'loadContract', 'loadPrivateHoldout', 'validateContract', 'runEvolution',
    'Ledger', 'ledgerPath', 'checkChangedPaths', 'checkClaims', 'checkProposal', 'isAllowedPath',
    'isProtectedPath', 'matchesGlob', 'assessRisk', 'collectEvidence', 'buildEvolutionReport',
    'formatEvolutionReport', 'EvoFenceError',
  ];
  for (const name of existing) assert.equal(typeof publicApi[name], 'function', `${name} must remain callable`);
  assert.equal(typeof publicApi.verifyBundle, 'function');
  assert.equal(publicApi.verifyBundle.length, 1);
});

test('Pi and OpenCode expose a bundle-file parameter for offline verification', async () => {
  const pi = await read('integrations/pi/evofence.js');
  assert.match(pi, /name: 'evofence_verify_bundle'/);
  assert.match(pi, /bundle: Type\.String/);
  assert.match(pi, /\['ledger', 'verify', '--bundle', bundle\]/);

  const opencode = await read('integrations/opencode/plugins/evofence.js');
  assert.match(opencode, /evofence_verify_bundle/);
  assert.match(opencode, /bundle: tool\.schema\.string\(\)/);
  assert.match(opencode, /\['ledger', 'verify', '--bundle', bundle\]/);

  const verify = COMMANDS.find((command) => command.name === 'ledger verify');
  assert.ok(verify);
  assert.equal(verify.usage, 'ledger verify [--bundle <file>] [--json]');
});

test('each host documents its USD budget support, refusal, and alternative', async () => {
  const docs = {
    claude: await read('integrations/claude-code/README.md'),
    codex: await read('integrations/codex/README.md'),
    pi: await read('integrations/pi/README.md'),
    opencode: await read('integrations/opencode/README.md'),
    deepseek: await read('integrations/deepseek-harness/README.md'),
  };
  for (const [host, text] of Object.entries(docs)) {
    assert.match(text, /budgets\.max_usd/, `${host} must describe max_usd`);
    assert.match(text, /null/, `${host} must state an alternative`);
    assert.match(text, /alternative/i, `${host} must name the alternative`);
  }
  assert.match(docs.claude, /supports `budgets\.max_usd`/i);
  assert.match(docs.pi, /after-the-fact cumulative estimate/);
  assert.match(docs.pi, /response that crosses the threshold has already completed/);
  assert.match(docs.pi, /not the service provider's final bill/);
  assert.match(docs.codex, /UNSUPPORTED_COST_BUDGET/);
  assert.match(docs.opencode, /UNSUPPORTED_COST_BUDGET/);
  assert.match(docs.deepseek, /does not run an EvoFence adapter/);
});

test('JS integrations surface structured CLI errors and retain a fallback for non-JSON stderr', async () => {
  const messages = {
    missingMessage: 'missing',
    processErrorMessage: 'process',
    failureMessage: 'fallback',
    invalidMessage: 'invalid',
  };
  const stderr = JSON.stringify({ error: { code: 'LEDGER_UNAVAILABLE', message: 'Ledger unavailable.' } });
  assert.deepEqual(parsePiCliFailure(stderr, messages.failureMessage), {
    error: { code: 'LEDGER_UNAVAILABLE', message: 'Ledger unavailable.' },
  });
  assert.deepEqual(parseOpenCodeCliFailure(stderr, messages.failureMessage), {
    error: { code: 'LEDGER_UNAVAILABLE', message: 'Ledger unavailable.' },
  });
  assert.deepEqual(parsePiCliFailure('not JSON', messages.failureMessage), { error: 'fallback' });
  assert.deepEqual(parseOpenCodeCliFailure('not JSON', messages.failureMessage), { error: 'fallback' });
  assert.deepEqual(parsePiCliResult({ status: 0, stdout: '{"valid":true}\n', stderr: '' }, messages), { valid: true });
  assert.deepEqual(parseOpenCodeCliResult({ status: 0, stdout: '{"valid":true}\n', stderr: '' }, messages), { valid: true });

  const shimRoot = await mkdtemp(path.join(tmpdir(), 'evofence-integration-cli-'));
  const repository = await mkdtemp(path.join(tmpdir(), 'evofence-integration-repo-'));
  const originalPath = process.env.PATH;
  try {
    const initialized = spawnSync('git', ['init', '--quiet', repository], { encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    await mkdir(path.join(repository, '.evofence'));
    const cliPath = path.join(root, 'dist', 'cli.js');
    const commandName = process.platform === 'win32' ? 'evofence.cmd' : 'evofence';
    const commandPath = path.join(shimRoot, commandName);
    const command = process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${cliPath}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${cliPath}" "$@"\n`;
    await writeFile(commandPath, command, 'utf8');
    if (process.platform !== 'win32') await chmod(commandPath, 0o755);
    process.env.PATH = `${shimRoot}${path.delimiter}${originalPath}`;

    const piResult = runPiEvoFence(['ledger', 'verify'], repository, messages);
    const opencodeResult = runOpenCodeEvoFence(['ledger', 'verify'], repository, messages);
    assert.equal(typeof piResult.error?.code, 'string', JSON.stringify(piResult));
    assert.equal(typeof opencodeResult.error?.code, 'string', JSON.stringify(opencodeResult));
    assert.equal(piResult.error.code, opencodeResult.error.code);
    assert.notEqual(piResult.error.message, messages.failureMessage);
  } finally {
    process.env.PATH = originalPath;
    await rm(shimRoot, { recursive: true, force: true });
    await rm(repository, { recursive: true, force: true });
  }
});

test('all root-release hand-copy points read the root version without changing version values', async () => {
  const rootPackage = await readJson('package.json');
  const claudeMarketplace = await readJson('.claude-plugin/marketplace.json');
  const claudePlugin = await readJson('integrations/claude-code/.claude-plugin/plugin.json');
  const codexPortable = await readJson('integrations/codex/plugin.json');
  const codexManifest = await readJson('integrations/codex/.codex-plugin/plugin.json');
  const harnessPackage = await readJson('integrations/deepseek-harness/package.json');
  const harnessReadme = await read('integrations/deepseek-harness/README.md');
  const releaseTest = await read('test/release.test.js');
  const releaseTestVersion = releaseTest.match(/assert\.equal\(pkg\.version,\s*'([^']+)'\)/)?.[1];

  const points = [
    { file: '.claude-plugin/marketplace.json', field: 'metadata.version', value: claudeMarketplace.metadata.version },
    { file: '.claude-plugin/marketplace.json', field: 'plugins[0].version', value: claudeMarketplace.plugins[0].version },
    { file: 'integrations/claude-code/.claude-plugin/plugin.json', field: 'version', value: claudePlugin.version },
    { file: 'integrations/codex/plugin.json', field: 'version', value: codexPortable.version },
    { file: 'integrations/codex/.codex-plugin/plugin.json', field: 'version', value: codexManifest.version },
    { file: 'integrations/deepseek-harness/package.json', field: 'dependencies.evofence', value: harnessPackage.dependencies.evofence },
    { file: 'integrations/deepseek-harness/README.md', field: 'Runtime dependency evofence@<version>', value: harnessReadme.match(/Runtime dependency:\s*`evofence@([^`]+)`/)?.[1] },
    { file: 'test/release.test.js', field: "assert.equal(pkg.version, '<version>')", value: releaseTestVersion },
  ];
  assert.equal(points.length, 8);
  for (const point of points) assert.equal(point.value, rootPackage.version, `${point.file} ${point.field}`);

  // These three private integration packages intentionally have independent package versions;
  // they do not follow the root release version and must not be bumped in this node.
  const independentPackages = {};
  for (const name of ['opencode', 'pi', 'deepseek-harness']) {
    const packageJson = await readJson(`integrations/${name}/package.json`);
    independentPackages[name] = packageJson.version;
    assert.notEqual(packageJson.version, rootPackage.version, `${name} is a private, independently-versioned package`);
  }
  console.log(JSON.stringify({ rootVersion: rootPackage.version, handCopiedPoints: points, independentPrivatePackages: independentPackages }));
});

test('the project-level pi entry keeps a runtime-loadable .js target and src/ holds no .js twin', async () => {
  const entry = await read('.pi/extensions/evofence.js');
  const specifier = entry.match(/export\s+\{\s*default\s*\}\s+from\s+['"]([^'"]+)['"]/)?.[1];
  assert.ok(specifier, 'the project-level entry must re-export a default binding');
  assert.match(specifier, /\.js$/, 'Node cannot load a .ts extension at runtime');
  await exists(path.join('.pi/extensions', specifier));

  // `src/lib/adapter.ts` resolves the sidecar next to the running adapter module, so the CLI
  // adapter loads the compiled dist twin; a .ts-only source would break `run --adapter pi`.
  for (const file of ['src/lib/pi-tool-strategy.ts', 'src/lib/pi-tool-strategy-extension.ts']) await exists(file);
  for (const file of ['dist/lib/pi-tool-strategy.js', 'dist/lib/pi-tool-strategy-extension.js']) await exists(file);

  const sourceFiles = await readdir(path.join(root, 'src'), { recursive: true });
  const jsResidue = sourceFiles.filter((file) => file.endsWith('.js'));
  assert.deepEqual(jsResidue, [], 'src/ must hold no .js twin after the TypeScript conversion');
});
