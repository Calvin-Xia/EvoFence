import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bindPiDelegation } from '../../dist/hosts/pi/delegation.js';
import { config, evidence, hash, value, writeJson, record } from './io.mjs';
import { setup, sdk, makeSession, pool, cleanup, clock } from './native.mjs';
import { taskState } from './task-tools.mjs';
import { makeEffect, childPlan } from './graph.mjs';

let parent, delegation;
try {
  const result = JSON.parse(fs.readFileSync(path.join(evidence, 'result.json'))), abort = JSON.parse(fs.readFileSync(path.join(evidence, 'abort.json')));
  taskState.checks = fs.readdirSync(evidence).filter(f => /^check-[0-9]+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(evidence, f))));
  await setup();
  const manager = sdk.SessionManager.open(abort.file);
  const g = manager.getEntries().find(e => e.customType === 'evofence.kernel.pi.delegation.v1').data.authorized.grant;
  const graph = JSON.parse(fs.readFileSync(path.join(evidence, 'kernel-journal.json'))).effects[0].binding.graph;
  parent = await makeSession('quality', manager, null, async () =>
    'Independent Codex review found a hard-constraint issue in your current scratch task output. Read src/lib/cli/handlers/context.ts. Its digits/length/BigInt guards already guarantee a positive safe integer, making the final Number.isSafeInteger guard redundant. Simplify positiveIntegerOption to one necessary external boundary validation: raw undefined preserves absent behavior; raw must match decimal digits; parsed Number(raw) must be >0 and Number.isSafeInteger(parsed). This correctly rejects above-safe numeric inputs without BigInt or digit-length double checks. Keep all other functions/imports and error code INVALID_RUN_LIMIT unchanged. Use revise_validation to write full corrected file exactly once. Do not change any tests, other source, or contract. End after tool success.', {}, true, true);
  assert.equal(parent.sessionId, result.parentId); record('stage', { stage: 'quality-repair', sessionId: result.parentId });
  const e = makeEffect('quality-repair', graph, result.parentId, g);
  const r = value(await parent.host.execute({ effect: e, grant: g })); assert.equal(r.status, 'completed', JSON.stringify(r.error));
  let verifyId, verifyFile;
  delegation = value(bindPiDelegation({ version: config.piVersion, kernelSessionId: 'pi-scenario', parentSessionId: result.parentId,
    manager, parent: parent.host, parentCapabilities: ['host.agent', 'host.delegate'], clock, requests: pool,
    model: { provider: config.provider, modelId: config.model, thinkingLevel: config.thinking },
    append: (name, data) => manager.appendCustomEntry(name, data),
    plan: async a => ({ ok: true, value: childPlan(a, 'quality-verifier') }),
    async create(spec) {
      const m = sdk.SessionManager.create(config.scratch, path.join(evidence, 'quality-verifier-session'));
      const child = await makeSession('quality-verifier', m, spec, async () =>
        'You are a fresh independent verifier, no code authorship. Read EXACT files test/ledger-limit-scenario.test.js and src/lib/cli/handlers/context.ts (those paths exist). The numeric helper was simplified after Codex identified redundant guards. Review safe-integer and absent-option behavior; call run_checks final=true exactly once. This runs current build, two focused rounds and all four gates. Do not guess filenames, edit source, install, or weaken tests. Report actual exits and any unresolved failure.', {}, true);
      verifyId = child.sessionId; verifyFile = m.getSessionFile();
      record('child-created', { parentId: result.parentId, childId: verifyId, role: 'verifier-quality', file: verifyFile });
      return { ok: true, value: child };
    }, restore: async () => { throw new Error('quality verifier has no interrupted child to restore'); } }));
  const ve = makeEffect('quality-final', graph, result.parentId, g);
  ve.kind = 'host.delegate'; ve.payload.graphRef = graph; ve.payload.context = { ...ve.payload.context, isolation: 'fresh' };
  record('stage', { stage: 'quality-final' });
  const verified = value(await delegation.host.execute({ effect: ve, grant: g })); assert.equal(verified.status, 'completed', JSON.stringify(verified.error));
  const checks = taskState.checks.filter(c => c.label.startsWith('quality-final:'));
  assert.equal(checks.length, 6); assert(checks.every(c => c.code === 0));
  writeJson(path.join(evidence, 'quality-repair.json'), { parentId: result.parentId, repairReceipt: r,
    verifierId: verifyId, verifierFile: verifyFile, verifyReceipt: verified, checks: checks.map(({ label, code }) => ({ label, code })) });
  const hashes = JSON.parse(fs.readFileSync(path.join(evidence, 'artifact-hashes.json'))).map(row => ({ ...row,
    sha256: hash(fs.readFileSync(path.join(config.scratch, row.file))) })); writeJson(path.join(evidence, 'artifact-hashes.json'), hashes);
  const patch = spawnSync('git', ['diff', '--binary'], { cwd: config.scratch, encoding: 'utf8', windowsHide: true }); assert.equal(patch.status, 0);
  fs.writeFileSync(path.join(evidence, 'scratch.patch'), patch.stdout);
  for (const file of ['test/ledger-limit-scenario.test.js', 'docs/cli-limit-scenario.md']) {
    const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', '/dev/null', file], { cwd: config.scratch, encoding: 'utf8', windowsHide: true });
    assert.equal(diff.status, 1, diff.stderr); fs.appendFileSync(path.join(evidence, 'scratch.patch'), diff.stdout);
  }
  record('quality-completed', { parentId: result.parentId, verifierId: verifyId });
} catch (error) { record('fatal', { name: error.name, message: error.message }); process.exitCode = 1; }
finally { if (delegation) value(await delegation.close('unload')); parent?.dispose(); await cleanup(); }
