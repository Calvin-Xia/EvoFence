import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, link, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeProjectCandidate } from '../dist/learning/assets/index.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'l4-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project'), stagingRoot = path.join(projectRoot, 'staging');
  const skills = path.join(root, 'user-skills'), outside = path.join(root, 'project-other');
  await Promise.all([mkdir(stagingRoot, { recursive: true }), mkdir(skills), mkdir(outside)]);
  const original = path.join(skills, 'SKILL.md'); await writeFile(original, 'original user Skill');
  return { root, projectRoot, stagingRoot, skills, outside, original,
    area: { projectRoot, stagingRoot, userSkillRoots: [skills] } };
}
test('project candidate is created once while existing user Skills remain byte-identical', async t => {
  const f = await fixture(t), result = await writeProjectCandidate(f.area, 'candidate.md', 'new candidate');
  assert.equal(result.ok, true); assert.equal(await readFile(result.value, 'utf8'), 'new candidate');
  const repeated = await writeProjectCandidate(f.area, 'candidate.md', 'replacement');
  assert.equal(repeated.error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal(await readFile(result.value, 'utf8'), 'new candidate');
  assert.equal(await readFile(f.original, 'utf8'), 'original user Skill');
});
test('DoD2 out-of-project writes reject traversal, absolute paths and sibling prefix tricks', async t => {
  const f = await fixture(t);
  for (const filename of ['../escape.md', '..\\escape.md', f.original, '', 'C:escape.md', 'a/../../escape.md']) {
    assert.equal((await writeProjectCandidate(f.area, filename, 'bad')).error.code, 'EFK_ASSET_SCOPE_DENIED');
  }
  const badArea = { ...f.area, stagingRoot: f.outside };
  const escaped = await writeProjectCandidate(badArea, 'escape.md', 'bad');
  assert.equal(escaped.ok, false); assert.equal(escaped.error.code, 'EFK_ASSET_SCOPE_DENIED');
  assert.deepEqual(await readdir(f.outside), []); assert.deepEqual(await readdir(f.stagingRoot), []);
});
test('existing Skill roots are read-only even when explicitly passed as staging', async t => {
  const f = await fixture(t);
  const area = { ...f.area, projectRoot: f.root, stagingRoot: f.skills };
  assert.equal((await writeProjectCandidate(area, 'new.md', 'bad')).error.code, 'EFK_ASSET_SCOPE_DENIED');
  assert.equal(await readFile(f.original, 'utf8'), 'original user Skill'); assert.deepEqual(await readdir(f.skills), ['SKILL.md']);
});
test('resolved directory junctions cannot escape staging or write a user Skill source', async t => {
  const f = await fixture(t);
  await symlink(f.skills, path.join(f.stagingRoot, 'source-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await writeProjectCandidate(f.area, 'source-alias/escape.md', 'bad')).error.code, 'EFK_ASSET_SCOPE_DENIED');
  await symlink(f.outside, path.join(f.stagingRoot, 'outside-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await writeProjectCandidate(f.area, 'outside-alias/escape.md', 'bad')).error.code, 'EFK_ASSET_SCOPE_DENIED');
  assert.deepEqual(await readdir(f.outside), []); assert.deepEqual(await readdir(f.skills), ['SKILL.md']);
});
test('hardlinked user Skill bytes cannot be overwritten through a candidate filename', async t => {
  const f = await fixture(t); await link(f.original, path.join(f.stagingRoot, 'linked.md'));
  assert.equal((await writeProjectCandidate(f.area, 'linked.md', 'bad')).error.code, 'EFK_IDEMPOTENCY_COLLISION');
  assert.equal(await readFile(f.original, 'utf8'), 'original user Skill');
});
test('missing staging parents fail explicitly without mkdir or a fallback destination', async t => {
  const f = await fixture(t);
  assert.equal((await writeProjectCandidate(f.area, 'missing/candidate.md', 'bad')).error.code, 'EFK_ARTIFACT_UNAVAILABLE');
  assert.deepEqual(await readdir(f.stagingRoot), []);
});
