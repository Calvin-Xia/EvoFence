import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
const exists = (relativePath) => access(path.join(root, relativePath));

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
