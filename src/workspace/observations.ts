import { canonical } from '../kernel/store/identity.js';
import type { ExportedSession } from '../kernel/store/contracts.js';
import { sameBase } from '../runtime/workspace/rules.js';
import type { ArtifactRef, Binding, WorkspaceApplication, WorkspaceBase } from '../runtime/workspace/types.js';
import type { ApplicationRecord, WorkspaceOptions } from './types.js';
import { readBound } from './artifacts.js';
import { WorkspaceIOError } from './io.js';

/** A later, journal-confirmed application can explain why an old receipt is no longer the HEAD. */
export function knownSuccessor(options: WorkspaceOptions, record: ApplicationRecord, session: ExportedSession,
  current: WorkspaceBase): boolean {
  if (record.completed?.application.actualStatus !== 'applied' || record.after === null) return false;
  let cursor = record.after;
  const applied = new Set(session.events.filter(e => e.type === 'receipt.applied').map(e => e.payload.objectRef?.id));
  for (const receipt of session.receipts) {
    if (!applied.has(receipt.receiptId) || receipt.status !== 'completed' || receipt.effectId === record.authorized.effect.effectId) continue;
    const ref = receipt.artifactRefs.find(r => r.schema.name === 'WorkspaceApplication');
    if (ref === undefined) continue;
    const bytes = readBound(options.artifacts, options.digest, ref as ArtifactRef, 'WorkspaceApplication', receipt.binding as Binding, options.clock.now());
    if (!bytes.ok) throw new WorkspaceIOError(bytes.error.code, bytes.error.message);
    const next = JSON.parse(bytes.value) as WorkspaceApplication;
    if (next.effectId !== receipt.effectId || next.actualStatus !== 'applied' || next.after === null) {
      throw new WorkspaceIOError('EFK_ARTIFACT_BINDING_MISMATCH', 'successor receipt has no matching actual application');
    }
    if (sameBase(cursor, next.before)) cursor = next.after;
  }
  return sameBase(cursor, current) && canonical(cursor) !== canonical(record.after);
}
