import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { initializeFilesystemWorkspace } from '../dist/workspace/index.js';
import { canonical } from '../dist/kernel/store/identity.js';
import { fixture, candidate, intend, currentFiles, loadFixture, ok, err, text, digest } from './l3-workspace-support.test.js';

for (const kind of ['git', 'fs']) {
  test(`cp2 ${kind}: missing/stale lease, narrowed scope, false base and uncommitted effects cannot write`, async t => {
    const f = await fixture(kind, t), base = ok(await f.provider.base());
    const c = await candidate(f, 'guards', [{ path: 'a.txt', file: text('never\n') }]);
    const a = intend(f, 'guards', c);
    err(await f.provider.apply({ ...a, effect: { ...a.effect, leases: [] } }, c.ref), 'EFK_LEASE_STALE');
    err(await f.provider.apply({ ...a, effect: { ...a.effect, effectId: 'forged-effect' } }, c.ref), 'EFK_AUTHORITY_DENIED');
    err(await f.provider.apply({ ...a, grant: { ...a.grant, revoked: true } }, c.ref), 'EFK_GRANT_REVOKED');
    err(await f.provider.apply({ ...a, grant: { ...a.grant, scope: { ...a.grant.scope, writeResources: [] } } }, c.ref), 'EFK_AUTHORITY_DENIED');
    err(await f.provider.apply({ ...a, effect: { ...a.effect, binding: { ...a.effect.binding, baseDigest: digest.digest('false base') } } }, c.ref), 'EFK_ARTIFACT_BINDING_MISMATCH');
    assert.deepEqual(ok(await f.provider.base()), base);
    assert.equal(ok(f.store.outbox('session-1')).entries[0].state, 'intended');
  });
  test(`cp2 ${kind}: old writer fencing token is rejected across provider restart`, async t => {
    const f = await fixture(kind, t), a = await candidate(f, 'new', [{ path: 'a.txt', file: text('new\n') }], 5);
    ok(await f.provider.apply(intend(f, 'new', a), a.ref));
    const reopened = await loadFixture(f.root);
    const stale = await candidate(reopened, 'old', [{ path: 'b.txt', file: text('old writer\n') }], 4);
    err(await reopened.provider.apply(intend(reopened, 'old', stale), stale.ref), 'EFK_LEASE_STALE');
    assert.equal((await currentFiles(reopened))['b.txt'].content, 'base-b\n');
  });
  test(`cp3 ${kind}: journal-confirmed successors reconcile a historical receipt without blocking HEAD`, async t => {
    const f = await fixture(kind, t), a = await candidate(f, 'first', [{ path: 'a.txt', file: text('first\n') }], 1);
    const aa = intend(f, 'first', a), first = ok(await f.provider.apply(aa, a.ref));
    const b = await candidate(f, 'next', [{ path: 'b.txt', file: text('next\n') }], 2);
    ok(await f.provider.apply(intend(f, 'next', b), b.ref));
    const head = ok(await f.provider.base());
    assert.deepEqual(ok(await f.provider.reconcile('session-1', aa.effect.effectId)), first);
    assert.deepEqual(ok(await f.provider.base()), head);
    const c = await candidate(f, 'last', [{ path: 'a.txt', file: text('last\n') }], 3);
    assert.equal(ok(await f.provider.apply(intend(f, 'last', c), c.ref)).disposition, 'applied');
  });
  test(`cp1 ${kind}: custom patch content has schema/binding checks at the byte boundary`, async t => {
    const f = await fixture(kind, t), c = await candidate(f, 'bad-patch', [{ path: 'a.txt', file: text('never\n') }]);
    const original = JSON.parse(ok(f.artifacts.get(c.ref)));
    const bytes = canonical({ ...original, changes: [{ path: 'a.txt', file: { content: 9, executable: false } }] });
    const ref = { ...c.ref, id: 'malformed-patch', digest: digest.digest(bytes) };
    ok(f.artifacts.put(ref, bytes));
    const a = intend(f, 'bad-patch', { ...c, ref });
    err(await f.provider.apply(a, ref), 'EFK_SCHEMA_INVALID');
    assert.equal((await currentFiles(f))['a.txt'].content, 'base-a\n');
  });
}
test('cp1 fs: new project candidates never initialize or modify an existing global Skill directory', async t => {
  const f = await fixture('fs', t), global = path.join(f.root, 'global-skills');
  await mkdir(global); await writeFile(path.join(global, 'SKILL.md'), 'existing user skill');
  await assert.rejects(initializeFilesystemWorkspace(global, 'global', { 'SKILL.md': text('overwrite') }), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(global, 'SKILL.md'), 'utf8'), 'existing user skill');
  const c = await candidate(f, 'asset', [{ path: 'skills/new/SKILL.md', file: text('staged candidate') }]);
  assert.equal((await currentFiles(f))['skills/new/SKILL.md'].content, 'project candidate\n');
  assert.equal(ok(await f.provider.read(c.stage, 'skills/new/SKILL.md')).content, 'staged candidate');
  assert.equal(await readFile(path.join(global, 'SKILL.md'), 'utf8'), 'existing user skill');
});
