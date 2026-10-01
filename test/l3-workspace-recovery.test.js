import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkspaceProvider } from '../dist/workspace/index.js';
import { fixture, candidate, intend, undoRequest, currentFiles, loadFixture, ok, err, text, initial } from './l3-workspace-support.test.js';

for (const kind of ['git', 'fs']) {
  test(`cp3 ${kind}: atomic multi-file apply/undo has real receipts; repeated effect never rewrites`, async t => {
    const f = await fixture(kind, t), before = ok(await f.provider.base());
    const c = await candidate(f, 'apply', [{ path: 'a.txt', file: text('new-a\n') }, { path: 'b.txt', file: null },
      { path: 'skills/new/TOOL.md', file: text('staged tool\n') }]);
    const a = intend(f, 'apply', c);
    const result = ok(await f.provider.apply(a, c.ref));
    assert.equal(result.disposition, 'applied'); assert.equal(result.receipt.status, 'completed');
    const after = ok(await f.provider.base()); assert.notEqual(after.revision, before.revision);
    const files = await currentFiles(f); assert.equal(files['a.txt'].content, 'new-a\n'); assert.equal(files['b.txt'], undefined);
    assert.equal(files['skills/new/TOOL.md'].content, 'staged tool\n');
    const application = JSON.parse(ok(f.artifacts.get(result.evidence)));
    assert.deepEqual(application.before, before); assert.deepEqual(application.after, after); assert.equal(application.osSandbox, false);
    assert.match(result.receipt.observability.join(' '), /not an OS sandbox/);
    err(await f.provider.apply(a, c.ref), 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
    assert.deepEqual(ok(await f.provider.reconcile('session-1', a.effect.effectId)), result);
    const revert = await undoRequest(f, result, 'undo', 2);
    const reverted = ok(await f.provider.undo(revert, result.evidence)); assert.equal(reverted.disposition, 'undone');
    assert.deepEqual(await currentFiles(f), initial);
    const restored = ok(await f.provider.base()); assert.equal(restored.digest, before.digest); assert.notEqual(restored.revision, before.revision);
    t.diagnostic(JSON.stringify({ before, after, restored, receipt: result.receipt.receiptId, undoReceipt: reverted.receipt.receiptId }));
  });
  test(`cp3 ${kind}: partial candidate write failure preserves the entire old snapshot`, async t => {
    const f = await fixture(kind, t), before = ok(await f.provider.base());
    const c = await candidate(f, 'partial', [{ path: 'a.txt', file: text('a\n') }, { path: 'b.txt', file: text('b\n') }]);
    const a = intend(f, 'partial', c); let calls = 0;
    const faulted = createWorkspaceProvider({ ...f, checkpoint: async p => { if (p === 'candidate-file' && ++calls === 1) throw new Error('injected partial write failure'); } });
    const result = ok(await faulted.apply(a, c.ref)); assert.equal(result.disposition, 'failed');
    assert.equal(result.receipt.error.code, 'EFK_HOST_EXECUTION_FAILED');
    assert.deepEqual(ok(await f.provider.base()), before); assert.deepEqual(await currentFiles(f), initial);
    assert.equal(ok(f.store.outbox('session-1')).entries[0].state, 'resolved');
    err(await f.provider.apply(a, c.ref), 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
  });
  test(`cp3 ${kind}: lease expiration during prepare prevents publication`, async t => {
    const f = await fixture(kind, t), before = ok(await f.provider.base());
    const c = await candidate(f, 'expiry', [{ path: 'a.txt', file: text('expired\n') }]), a = intend(f, 'expiry', c);
    let now = 100;
    const writer = createWorkspaceProvider({ ...f, clock: { now: () => now }, checkpoint: async p => { if (p === 'prepared') now = 10001; } });
    const result = ok(await writer.apply(a, c.ref)); assert.equal(result.disposition, 'failed'); assert.equal(result.receipt.error.code, 'EFK_GRANT_EXPIRED');
    assert.deepEqual(ok(await f.provider.base()), before);
  });
  for (const point of ['claimed', 'candidate-file', 'prepared', 'published', 'receipt-saved']) {
    test(`cp3 ${kind}: SIGKILL at ${point}; reconcile uses actual bytes and never replays unknown`, { timeout: 30000 }, async t => {
      const f = await fixture(kind, t), before = ok(await f.provider.base());
      const c = await candidate(f, 'crash', [{ path: 'a.txt', file: text('atomic-a\n') }, { path: 'b.txt', file: text('atomic-b\n') }]);
      const a = intend(f, 'crash', c);
      await writeFile(path.join(f.root, 'worker.json'), JSON.stringify({ authorized: a, ref: c.ref }));
      const child = fork(fileURLToPath(new URL('./l3-workspace-support.test.js', import.meta.url)), ['--worker', f.root, point],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stderr = ''; child.stderr.on('data', b => { stderr += b; });
      const killed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('message', async message => {
          if (message.hit !== point) { child.kill('SIGKILL'); reject(new Error(`worker did not reach ${point}: ${JSON.stringify(message)}`)); return; }
          try { err(await f.provider.apply(a, c.ref), 'EFK_CLAIM_CONFLICT'); child.kill('SIGKILL'); }
          catch (error) { child.kill('SIGKILL'); reject(error); }
        });
        child.once('exit', (code, signal) => { if (signal === 'SIGKILL' || code !== 0) resolve({ code, signal }); else reject(new Error(`worker exited: ${stderr}`)); });
      });
      t.after(() => child.kill('SIGKILL'));
      const exit = await killed;
      const reopened = await loadFixture(f.root);
      assert.deepEqual(ok(reopened.store.replay('session-1')).unknownEffectIds, [a.effect.effectId]);
      err(await reopened.provider.apply(a, c.ref), 'EFK_EFFECT_NON_IDEMPOTENT_RETRY');
      const result = ok(await reopened.provider.reconcile('session-1', a.effect.effectId));
      const published = ['published', 'receipt-saved'].includes(point);
      assert.equal(result.disposition, published ? 'applied' : 'not-executed');
      const actual = await currentFiles(reopened);
      assert.equal(actual['a.txt'].content, published ? 'atomic-a\n' : 'base-a\n');
      assert.equal(actual['b.txt'].content, published ? 'atomic-b\n' : 'base-b\n');
      assert.equal(ok(reopened.store.replay('session-1')).unknownEffectIds.length, 0);
      const after = ok(await reopened.provider.base());
      assert.deepEqual(ok(await reopened.provider.reconcile('session-1', a.effect.effectId)), result);
      assert.deepEqual(ok(await reopened.provider.base()), after);
      assert.equal(ok(reopened.store.exportSession('session-1')).events.filter(e => e.type === 'effect.dispatched').length, 1);
      t.diagnostic(JSON.stringify({ point, exit, before, after, result: result.disposition, receipt: result.receipt.receiptId }));
    });
  }
  test(`DoD2 ${kind}: receipt/actual-state mismatch stays unknown, blocks another writer`, async t => {
    const f = await fixture(kind, t), c = await candidate(f, 'drift', [{ path: 'a.txt', file: text('applied\n') }]);
    const a = intend(f, 'drift', c), result = ok(await f.provider.apply(a, c.ref));
    const base = ok(await f.provider.base());
    const unmanaged = await f.driver.prepare(base, { ...await currentFiles(f), 'b.txt': text('unmanaged external drift\n') }, 'external-drift', undefined);
    ok(await f.driver.publish(base, unmanaged));
    const beforeReconcile = ok(await f.provider.base());
    const observed = ok(await f.provider.reconcile('session-1', a.effect.effectId));
    assert.equal(observed.disposition, 'unknown'); assert.deepEqual(observed.observed, beforeReconcile);
    assert.deepEqual(ok(await f.provider.base()), beforeReconcile);
    const third = await candidate(f, 'third', [{ path: 'a.txt', file: text('must block\n') }], 3);
    err(await f.provider.apply(intend(f, 'third', third), third.ref), 'EFK_CLAIM_CONFLICT');
    assert.equal(result.receipt.status, 'completed');
  });
}
