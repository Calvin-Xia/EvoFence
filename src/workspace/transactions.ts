import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { canonical } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { checkScope, changesBetween, writerAdmission, sameBase } from '../runtime/workspace/rules.js';
import type { AuthorizedEffect, ArtifactRef, StoreResult, WorkspaceBase, WorkspaceFiles, WorkspaceOutcome } from '../runtime/workspace/types.js';
import type { ApplicationRecord, WorkspaceOptions } from './types.js';
import { atomicJSON, ioError, json, exists } from './io.js';
import { acquireLock, recoveryLock, releaseLock } from './lock.js';
import { applicationKey } from './artifacts.js';
import { finish, outcome, recordPath } from './receipts.js';
import { knownSuccessor } from './observations.js';

export type TargetPlan = { readonly files: WorkspaceFiles } | { readonly conflict: Extract<WorkspaceOutcome, { disposition: 'rebase/replan' }> };
export function transactionOperations(options: WorkspaceOptions, instance: string) {
  const { driver, store, clock } = options, active = new Set<string>();
  function journal(authorized: AuthorizedEffect) {
    const { effect } = authorized;
    const exported = store.exportSession(effect.binding.sessionId);
    if (!exported.ok) return exported;
    const committed = exported.value.effects.find(e => e.effectId === effect.effectId);
    if (canonical(committed) !== canonical(effect)) return storeFail('EFK_AUTHORITY_DENIED', 'workspace effect is not the exact committed intention');
    if (exported.value.epoch !== effect.binding.epoch) return storeFail('EFK_LEASE_STALE', 'workspace effect belongs to an old session epoch');
    return exported;
  }
  async function fence(authorized: AuthorizedEffect): Promise<StoreResult<void>> {
    const lease = authorized.effect.leases.find(l => l.resourceId === driver.resourceId)!;
    const file = path.join(driver.controlDir, 'fence.json');
    if (await exists(file)) {
      const last = await json<{ token: number; owner: string }>(file);
      if (lease.fencingToken < last.token || (lease.fencingToken === last.token && lease.ownerClaimId !== last.owner)) {
        return storeFail('EFK_LEASE_STALE', 'older or competing fencing token cannot write integration');
      }
    }
    await atomicJSON(file, { token: lease.fencingToken, owner: lease.ownerClaimId });
    return storeOk(undefined);
  }
  async function run(authorized: AuthorizedEffect, operation: 'apply' | 'undo', patchRef: ArtifactRef | null,
    plan: (current: WorkspaceBase) => Promise<TargetPlan>): Promise<StoreResult<WorkspaceOutcome>> {
    const admitted = writerAdmission(authorized, driver.workspaceId, driver.resourceId, clock.now());
    if (!admitted.ok) return admitted;
    const linked = journal(authorized);
    if (!linked.ok) return linked;
    const { effect } = authorized, key = applicationKey(effect.binding.sessionId, effect.effectId);
    const projected = store.outbox(effect.binding.sessionId);
    if (!projected.ok) return projected;
    const entry = projected.value.entries.find(e => e.effectId === effect.effectId)!;
    if (entry.state !== 'intended') return storeFail('EFK_EFFECT_NON_IDEMPOTENT_RETRY', 'claimed workspace effect must reconcile, never reapply', [effect.effectId]);
    const lock = await acquireLock(driver.controlDir, 'writer.lock', instance, key);
    if (!lock.ok) return lock;
    active.add(key);
    let record: ApplicationRecord | null = null, release = true;
    try {
      const before = await driver.current();
      if (before.workspaceId !== driver.workspaceId) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'integration workspace identity changed');
      const target = await plan(before);
      if ('conflict' in target) return storeOk(target.conflict);
      if (effect.binding.baseDigest !== before.digest) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'effect does not bind the actual application base');
      const scope = authorized.grant.scope;
      for (const c of changesBetween(await driver.files(before), target.files)) {
        const permitted = checkScope(scope, c.path, 'write', options.resourcePaths); if (!permitted.ok) return permitted;
      }
      const fenced = await fence(authorized); if (!fenced.ok) return fenced;
      const fresh = journal(authorized); if (!fresh.ok) return fresh;
      const claimed = store.dispatchEffect(effect.binding.sessionId, { expectedRevision: fresh.value.revision,
        epoch: fresh.value.epoch, effectId: effect.effectId, claimId: `wc:${key.slice(0, 48)}` });
      if (!claimed.ok) return claimed;
      release = false;
      await mkdir(path.join(driver.controlDir, 'applications'), { recursive: true });
      record = { key, authorized, operation, before, after: null, patchRef, completed: null };
      await atomicJSON(recordPath(options, key), record);
      await options.checkpoint?.('claimed');
      const after = await driver.prepare(before, target.files, key, options.checkpoint);
      record = { ...record, after };
      await atomicJSON(recordPath(options, key), record);
      await options.checkpoint?.('prepared');
      // A lengthy prepare can outlive a lease or session epoch; check the live boundary again.
      const live = writerAdmission(authorized, driver.workspaceId, driver.resourceId, clock.now());
      const currentJournal = journal(authorized);
      if (!live.ok || !currentJournal.ok) {
        const failed = await finish(options, record, 'failed', !live.ok ? live.error : !currentJournal.ok ? currentJournal.error : null, false);
        release = failed.ok; return failed;
      }
      const published = await driver.publish(before, after);
      if (!published.ok) {
        const failed = await finish(options, record, 'failed', published.error, false); release = failed.ok; return failed;
      }
      await options.checkpoint?.('published');
      const observed = await driver.current();
      if (!sameBase(observed, after)) return storeOk({ disposition: 'unknown', effectId: effect.effectId, observed });
      const completed = await finish(options, record, 'applied', null, false);
      release = completed.ok; return completed;
    } catch (error) {
      const actual = await driver.current();
      if (record !== null && sameBase(actual, record.before) && record.completed === null) {
        const failed = await finish(options, record, 'failed', ioError(error), false); release = failed.ok; return failed;
      }
      // Publication/receipt commit may have happened. Retain the lock and journal claim for reconcile.
      return { ok: false, error: ioError(error) };
    } finally {
      active.delete(key);
      if (release) await releaseLock(lock.value);
    }
  }
  async function reconcile(sessionId: string, effectId: string): Promise<StoreResult<WorkspaceOutcome>> {
    const key = applicationKey(sessionId, effectId);
    const lock = await recoveryLock(driver.controlDir, instance, key, active.has(key));
    if (!lock.ok) return lock;
    let release = false;
    try {
      const current = await driver.current();
      if (!await exists(recordPath(options, key))) return storeFail('EFK_EFFECT_UNKNOWN', 'no host application record; unknown stays unknown');
      const record = await json<ApplicationRecord>(recordPath(options, key));
      const exported = store.exportSession(sessionId); if (!exported.ok) return exported;
      const committed = exported.value.effects.find(e => e.effectId === effectId);
      if (canonical(committed) !== canonical(record.authorized.effect)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'host record and journal intention differ');
      if (record.completed !== null && options.digest.digest(canonical(record.completed.application)) !== record.completed.evidence.digest) {
        return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'host receipt evidence content was changed');
      }
      const expected = record.completed?.application.actualStatus === 'applied' ? record.after : record.before;
      if (record.completed !== null && expected !== null && sameBase(current, expected)) {
        const settled = exported.value.receipts.find(r => r.receiptId === record.completed!.receipt.receiptId);
        if (settled !== undefined) {
          if (canonical(settled) !== canonical(record.completed.receipt)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'host receipt differs from the journal receipt');
          release = true; return storeOk(outcome(record));
        }
      }
      const applied = record.after !== null && sameBase(current, record.after);
      const untouched = sameBase(current, record.before);
      if (knownSuccessor(options, record, exported.value, current)) { release = true; return storeOk(outcome(record)); }
      if (!applied && !untouched) return storeOk({ disposition: 'unknown', effectId, observed: current });
      if (record.completed !== null && !sameBase(current, expected!)) return storeOk({ disposition: 'unknown', effectId, observed: current });
      const result = await finish(options, record, applied ? 'applied' : 'not-executed', null, true);
      release = result.ok; return result;
    } catch (error) { return { ok: false, error: ioError(error) }; }
    finally { if (release) await releaseLock(lock.value); }
  }
  return { run, reconcile };
}
