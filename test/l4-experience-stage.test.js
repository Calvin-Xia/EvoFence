import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageCandidate, collectGeneration } from '../dist/learning/proposals/index.js';
import { fixture, value, rejected, modelFixture } from './l4-experience-fixtures.test.js';

async function areaFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'l4-experience-stage-'));
  t.after(async () => {
    const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('l4-experience-stage-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const projectRoot = path.join(root, 'project'), stagingRoot = path.join(projectRoot, 'staged');
  const skills = path.join(root, 'global-skills'), control = path.join(root, 'control-plane');
  await Promise.all([mkdir(stagingRoot, { recursive: true }), mkdir(skills), mkdir(control)]);
  await writeFile(path.join(skills, 'SKILL.md'), 'USER_SKILL_ORIGINAL');
  await writeFile(path.join(control, 'state.json'), 'CONTROL_ORIGINAL');
  return { root, projectRoot, stagingRoot, skills, control, area: { projectRoot, stagingRoot, userSkillRoots: [skills] } };
}

test('DoD2 candidate only lands in immutable project staging; global Skills and control plane stay byte-identical', async t => {
  const a = await areaFixture(t), f = fixture(), experience = f.experience(), [candidate] = f.candidates();
  const filename = value(await stageCandidate(candidate, experience, a.area, 1000, f.ports));
  assert.equal(path.dirname(filename), await realpath(a.stagingRoot));
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), candidate);
  rejected(await stageCandidate(candidate, experience, a.area, 1000, f.ports), 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal(await readFile(path.join(a.skills, 'SKILL.md'), 'utf8'), 'USER_SKILL_ORIGINAL');
  assert.equal(await readFile(path.join(a.control, 'state.json'), 'utf8'), 'CONTROL_ORIGINAL');
  assert.deepEqual(await readdir(a.skills), ['SKILL.md']); assert.deepEqual(await readdir(a.control), ['state.json']);
});

test('DoD2 invalid candidates, promoted states and model-chosen paths cause no staged writes', async t => {
  const a = await areaFixture(t), f = fixture(), experience = f.experience(), [candidate] = f.candidates();
  for (const change of [{ qualification: 'promoted' }, { candidateId: '../../global-skills/SKILL.md' },
    { content: 'forged candidate' }]) {
    rejected(await stageCandidate({ ...candidate, ...change }, experience, a.area, 1000, f.ports), 'EFK_ARTIFACT_DIGEST_MISMATCH');
  }
  assert.deepEqual(await readdir(a.stagingRoot), []);
});

test('DoD2 staging outside project or in a user Skill root is denied, including junction aliases', async t => {
  const a = await areaFixture(t), f = fixture(), experience = f.experience(), [candidate] = f.candidates();
  rejected(await stageCandidate(candidate, experience, { ...a.area, stagingRoot: a.control }, 1000, f.ports), 'EFK_ASSET_SCOPE_DENIED');
  rejected(await stageCandidate(candidate, experience, { ...a.area, projectRoot: a.root, stagingRoot: a.skills }, 1000, f.ports), 'EFK_ASSET_SCOPE_DENIED');
  const alias = path.join(a.projectRoot, 'alias');
  await symlink(a.control, alias, process.platform === 'win32' ? 'junction' : 'dir');
  rejected(await stageCandidate(candidate, experience, { ...a.area, stagingRoot: alias }, 1000, f.ports), 'EFK_ASSET_SCOPE_DENIED');
  assert.equal(await readFile(path.join(a.control, 'state.json'), 'utf8'), 'CONTROL_ORIGINAL');
});

test('cp3 host-generated staging requires verified journal accounting and performs no second host call', async t => {
  const a = await areaFixture(t), m = await modelFixture();
  const [candidate] = value(collectGeneration(m.experience, m.plan, m.h.seed.sessionId, m.effect.effectId, 1000, m.ports));
  rejected(await stageCandidate(candidate, m.experience, a.area, 1000, m.ports), 'EFK_USAGE_INCOMPLETE');
  const model = { plan: m.plan, collector: m.ports, sessionId: m.h.seed.sessionId, effectId: m.effect.effectId };
  const filename = value(await stageCandidate(candidate, m.experience, a.area, 1000, m.ports, model));
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).generation.estimatedUsdMicros, 37);
  assert.equal(m.h.calls.execute, 1); assert.equal(m.h.calls.evaluate, 0);
});
