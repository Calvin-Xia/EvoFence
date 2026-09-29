import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { COMMANDS } from '../dist/lib/cli/catalog.js';
import * as publicApi from '../dist/index.js';

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

const INTEGRATION_COMMAND_FILES = [
  'integrations/claude-code/commands/inspect-ledger.md',
  'integrations/claude-code/commands/run-evolution.md',
  'integrations/codex/skills/inspect-ledger/SKILL.md',
  'integrations/codex/skills/run-evolution/SKILL.md',
  'integrations/opencode/README.md',
];

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
  assert.equal(doctor.usage, 'doctor [--adapter <name>] [--json]');

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
