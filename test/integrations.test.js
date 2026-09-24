import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
const exists = (relativePath) => access(path.join(root, relativePath));

test('Codex and Claude marketplaces point to complete, namespaced plugins', async () => {
  const codexMarketplace = await readJson('.agents/plugins/marketplace.json');
  const codexPlugin = codexMarketplace.plugins[0];
  assert.equal(codexPlugin.name, 'evofence');
  assert.equal(codexPlugin.source.path, './integrations/codex');
  await exists('integrations/codex/.codex-plugin/plugin.json');
  const codexManifest = await readJson('integrations/codex/.codex-plugin/plugin.json');
  assert.equal(codexManifest.name, 'evofence');
  assert.equal(codexManifest.skills, './skills/');
  for (const name of ['inspect-ledger', 'run-evolution']) {
    const skill = await readFile(path.join(root, 'integrations/codex/skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^name: ${name}$`, 'm'));
  }

  const claudeMarketplace = await readJson('.claude-plugin/marketplace.json');
  assert.equal(claudeMarketplace.plugins[0].name, 'evofence');
  assert.equal(claudeMarketplace.plugins[0].source, './integrations/claude-code');
  await exists('integrations/claude-code/.claude-plugin/plugin.json');
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
});
