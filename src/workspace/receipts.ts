import path from 'node:path';
import { storeOk } from '../kernel/store/contracts.js';
import { canonical } from '../kernel/store/identity.js';
import type { StoreResult, Receipt, ArtifactRef as WireArtifactRef } from '../kernel/store/contracts.js';
import type { Binding, WorkspaceApplication, WorkspaceOutcome } from '../runtime/workspace/types.js';
import type { ErrorEnvelope } from '../protocol/index.js';
import type { Protocol } from '../runtime/host-port/types.js';
import type { ApplicationRecord, WorkspaceOptions } from './types.js';
import { atomicJSON } from './io.js';
import { putArtifact } from './artifacts.js';

export const recordPath = (options: WorkspaceOptions, key: string) => path.join(options.driver.controlDir, 'applications', `${key}.json`);
export function outcome(record: ApplicationRecord): WorkspaceOutcome {
  const completed = record.completed!;
  const disposition = completed.application.actualStatus === 'applied'
    ? (record.operation === 'undo' ? 'undone' : 'applied') : completed.application.actualStatus;
  return { disposition, receipt: completed.receipt, evidence: completed.evidence };
}
export async function finish(options: WorkspaceOptions, record: ApplicationRecord,
  status: WorkspaceApplication['actualStatus'], error: ErrorEnvelope | null, reconcile: boolean): Promise<StoreResult<WorkspaceOutcome>> {
  const { artifacts, digest, store } = options, { effect } = record.authorized;
  let completed = record.completed;
  if (completed === null) {
    const application: WorkspaceApplication = { effectId: effect.effectId, operation: record.operation,
      before: record.before, after: status === 'applied' ? record.after : null, actualStatus: status, patchRef: record.patchRef, osSandbox: false };
    const evidence = putArtifact(artifacts, digest, effect.protocol as Protocol, effect.binding as Binding, 'WorkspaceApplication', application);
    if (!evidence.ok) return evidence;
    const receipt: Receipt = { protocol: effect.protocol, receiptId: `wr:${record.key.slice(0, 48)}`, effectId: effect.effectId,
      hostInvocationId: `wi:${record.key.slice(0, 48)}`, binding: effect.binding,
      status: status === 'applied' ? 'completed' : status, artifactRefs: [evidence.value as WireArtifactRef], usage: [],
      observability: [`workspace:${record.before.workspaceId}`, `before:${record.before.digest}`,
        `after:${application.after?.digest ?? record.before.digest}`, 'same-user; worktree is not an OS sandbox'], error };
    completed = { receipt, evidence: evidence.value, application };
    record = { ...record, completed };
    await atomicJSON(recordPath(options, record.key), record);
    await options.checkpoint?.('receipt-saved');
  } else {
    // A restarted artifact backend may be empty; restore exact host bytes and their identities.
    const restored = artifacts.put(completed.evidence as WireArtifactRef, canonical(completed.application));
    if (!restored.ok) return restored;
  }
  const objectRef = putArtifact(artifacts, digest, effect.protocol as Protocol, effect.binding as Binding, 'Receipt', completed.receipt, completed.receipt.receiptId);
  if (!objectRef.ok) return objectRef;
  const current = store.exportSession(effect.binding.sessionId);
  if (!current.ok) return current;
  const input = { expectedRevision: current.value.revision, epoch: current.value.epoch, receipt: completed.receipt, objectRef: objectRef.value as WireArtifactRef };
  const committed = reconcile ? store.reconcileEffect(effect.binding.sessionId, input) : store.applyReceipt(effect.binding.sessionId, input);
  if (!committed.ok) return committed;
  return storeOk(outcome(record));
}
