import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { createWorkspaceProvider } from '../dist/workspace/index.js';
import { fixture, candidate, intend, currentFiles, ok, err, binding, grant, text, digest } from './l3-workspace-support.test.js';

for (const kind of ['git', 'fs']) {
  test(`cp1 ${kind}: isolated candidates share immutable base; read/write scope and seal`, async t => {
    const f = await fixture(kind, t), base = ok(await f.provider.base());
    assert.equal(base.osSandbox, false);
    const a = ok(await f.provider.stage({ base, binding: binding(base, 'one'), grant: grant(base) }));
    const b = ok(await f.provider.stage({ base, binding: binding(base, 'two'), grant: grant(base) }));
    ok(await f.provider.write(a, { path: 'a.txt', file: text('candidate\n') }));
    assert.equal(ok(await f.provider.read(b, 'a.txt')).content, 'base-a\n');
    assert.equal((await currentFiles(f))['a.txt'].content, 'base-a\n');
    for (const p of ['../outside', 'C:/Skills/global', '.git/config', 'a.txt:stream', 'a.txt/../b.txt', 'CON', 'outside.txt']) {
      err(await f.provider.write(a, { path: p, file: text('escape') }), 'EFK_AUTHORITY_DENIED');
      err(await f.provider.read(a, p), 'EFK_AUTHORITY_DENIED');
    }
    assert.deepEqual(ok(await f.provider.diff(a)).map(c => c.path), ['a.txt']);
    const sealed = ok(await f.provider.seal(a));
    assert.match(sealed.digest, /^sha256:/);
    err(await f.provider.write(a, { path: 'b.txt', file: text('late') }), 'EFK_CLAIM_CONFLICT');
    assert.deepEqual(ok(await f.provider.seal(a)), sealed);
    err(await f.provider.stage({ base: { ...base, revision: 'drift' }, binding: binding(base, 'bad'), grant: grant(base) }), 'EFK_ARTIFACT_BINDING_MISMATCH');
    err(await f.provider.stage({ base, binding: { ...binding(base, 'bad'), baseDigest: digest.digest('different') }, grant: grant(base) }), 'EFK_ARTIFACT_BINDING_MISMATCH');
    err(await f.provider.stage({ base, binding: binding(base, 'os'), grant: grant(base, 1, { trustDomain: 'os-sandbox' }) }), 'EFK_AUTHORITY_DENIED');
    const forged = { ...a, grant: grant(base, 1, { writeResources: ['outside'] }) };
    err(await f.provider.write(forged, { path: 'outside.txt', file: text('bad') }), 'EFK_AUTHORITY_DENIED');
  });
  test(`cp2 ${kind}: same-base concurrent patchers conflict -> rebase/replan; no blind merge`, async t => {
    const f = await fixture(kind, t);
    const [a, b] = await Promise.all([candidate(f, 'a', [{ path: 'a.txt', file: text('left\n') }], 1),
      candidate(f, 'b', [{ path: 'a.txt', file: text('right\n') }], 2)]);
    const aa = intend(f, 'a', a), bb = intend(f, 'b', b);
    assert.equal(ok(await f.provider.apply(aa, a.ref)).disposition, 'applied');
    const conflict = ok(await f.provider.apply(bb, b.ref));
    assert.equal(conflict.disposition, 'rebase/replan');
    assert.deepEqual(conflict.conflict.files, ['a.txt']);
    assert.equal(conflict.conflict.proposedBase.revision, a.base.revision);
    assert.notEqual(conflict.conflict.currentBase.revision, a.base.revision);
    assert.equal((await currentFiles(f))['a.txt'].content, 'left\n');
    assert.equal(ok(f.store.outbox('session-1')).entries.find(e => e.effectId === bb.effect.effectId).state, 'intended');
    const replanned = await candidate(f, 'replan', [{ path: 'a.txt', file: text('reviewed right\n') }], 3);
    assert.equal(ok(await f.provider.apply(intend(f, 'replan', replanned), replanned.ref)).disposition, 'applied');
    assert.equal((await currentFiles(f))['a.txt'].content, 'reviewed right\n');
  });
  test(`cp2 ${kind}: two provider instances have a single integration writer`, async t => {
    const f = await fixture(kind, t);
    const a = await candidate(f, 'a', [{ path: 'a.txt', file: text('a\n') }], 1), b = await candidate(f, 'b', [{ path: 'b.txt', file: text('b\n') }], 2);
    const aa = intend(f, 'a', a), bb = intend(f, 'b', b);
    let unblock, entered;
    const wait = new Promise(resolve => { unblock = resolve; }), ready = new Promise(resolve => { entered = resolve; });
    const writer = createWorkspaceProvider({ ...f, checkpoint: async point => { if (point === 'prepared') { entered(); await wait; } } });
    const running = writer.apply(aa, a.ref);
    await Promise.race([ready, running.then(result => { ok(result); assert.fail('writer did not reach prepared checkpoint'); })]);
    const loser = await f.provider.apply(bb, b.ref);
    err(loser, 'EFK_CLAIM_CONFLICT');
    const during = await currentFiles(f); assert.equal(during['a.txt'].content, 'base-a\n');
    unblock(); assert.equal(ok(await running).disposition, 'applied');
    assert.equal((await currentFiles(f))['b.txt'].content, 'base-b\n');
  });
  test(`cp1 ${kind}: actual linked path escape is denied`, async t => {
    const f = await fixture(kind, t), base = ok(await f.provider.base());
    const stage = ok(await f.provider.stage({ base, binding: binding(base, 'link'), grant: grant(base, 1, { writeResources: ['escape'], readResources: ['escape'] }) }));
    const record = JSON.parse(await readFile(path.join(f.driver.controlDir, 'stage-records', `${stage.stageId}.json`), 'utf8'));
    const outside = path.join(f.root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'keep.txt'), 'unchanged');
    await symlink(outside, path.join(record.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    err(await f.provider.write(stage, { path: 'escape/keep.txt', file: text('bad') }), 'EFK_AUTHORITY_DENIED');
    assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'unchanged');
    err(await f.provider.seal(stage), 'EFK_AUTHORITY_DENIED');
  });
}
