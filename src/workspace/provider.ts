import { randomUUID } from 'node:crypto';
import { canonical } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { scopeWithin } from '../runtime/host-port/grant.js';
import { applyChanges, patchConflict, sameBase } from '../runtime/workspace/rules.js';
import type { Binding, StoreResult, WorkspaceApplication, WorkspacePort } from '../runtime/workspace/types.js';
import { applicationKey, parsePatch, readBound } from './artifacts.js';
import { ioError, json } from './io.js';
import { recordPath } from './receipts.js';
import type { ApplicationRecord, WorkspaceOptions } from './types.js';
import { stageOperations } from './stages.js';
import { transactionOperations } from './transactions.js';

/** Construction performs no I/O and does not construct/discover any backend. */
export function createWorkspaceProvider(options: WorkspaceOptions): WorkspacePort {
  const instance = randomUUID(), stages = stageOperations(options, instance), txn = transactionOperations(options, instance);
  const { driver, artifacts, digest, clock } = options;
  const boundary = async <T>(call: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> => {
    try { return await call(); } catch (error) { return { ok: false, error: ioError(error) }; }
  };
  return {
    stage: request => boundary(() => stages.stage(request)),
    read: (stage, file) => boundary(() => stages.read(stage, file)),
    write: (stage, change) => boundary(() => stages.write(stage, change)),
    diff: stage => boundary(() => stages.diff(stage)),
    seal: stage => boundary(() => stages.seal(stage)),
    async base() {
      try { return storeOk(await driver.current()); }
      catch (error) { return { ok: false, error: ioError(error) }; }
    },
    async apply(authorized, ref) {
      try {
        if (!authorized.effect.inputRefs.some(r => r.id === ref.id && r.digest === ref.digest)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'patch is not an exact effect input');
        const bytes = readBound(artifacts, digest, ref, 'WorkspacePatch', authorized.effect.binding as Binding, clock.now());
        if (!bytes.ok) return bytes;
        const patch = parsePatch(bytes.value);
        if (canonical(patch.binding) !== canonical(authorized.effect.binding) || patch.base.digest !== patch.binding.baseDigest) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'patch bytes do not bind the effect/base');
        if (!scopeWithin(patch.scope, authorized.grant.scope)) return storeFail('EFK_AUTHORITY_DENIED', 'patch scope exceeds the integration grant');
        return await txn.run(authorized, 'apply', ref, async current => {
          const old = await driver.files(patch.base), actual = await driver.files(current);
          const conflict = patchConflict(patch.base, current, patch.changes, old, actual);
          return conflict === null ? { files: applyChanges(old, patch.changes) }
            : { conflict: { disposition: 'rebase/replan', conflict } };
        });
      } catch (error) { return { ok: false, error: ioError(error) }; }
    },
    async undo(authorized, evidence) {
      try {
        if (!authorized.effect.inputRefs.some(r => r.id === evidence.id && r.digest === evidence.digest) || evidence.binding === null) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'undo requires the exact previous receipt evidence');
        const bytes = readBound(artifacts, digest, evidence, 'WorkspaceApplication', evidence.binding, clock.now());
        if (!bytes.ok) return bytes;
        const application = JSON.parse(bytes.value) as WorkspaceApplication;
        const previous = await json<ApplicationRecord>(recordPath(options, applicationKey(evidence.binding.sessionId, application.effectId)));
        if (previous.completed?.evidence.digest !== evidence.digest || application.actualStatus !== 'applied' || application.after === null) return storeFail('EFK_ACTIVATION_UNCONFIRMED', 'undo source is not an actual application receipt');
        return await txn.run(authorized, 'undo', evidence, async current => {
          const before = await driver.files(application.before), after = await driver.files(application.after!);
          if (!sameBase(current, application.after!)) return { conflict: { disposition: 'rebase/replan', conflict: {
            action: 'rebase/replan', proposedBase: application.after!, currentBase: current,
            files: Object.keys(after).filter(p => canonical(after[p]) !== canonical(before[p])) } } };
          return { files: before };
        });
      } catch (error) { return { ok: false, error: ioError(error) }; }
    },
    reconcile: (sessionId, effectId) => boundary(() => txn.reconcile(sessionId, effectId)),
  };
}
