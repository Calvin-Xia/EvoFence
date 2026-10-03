import { partitionFeedback, withheldReason, checkAvailability } from '../../kernel/artifacts/index.js';
import type { ArtifactRef, Audience } from '../../kernel/artifacts/index.js';
import { storeFail, storeOk } from '../../kernel/store/contracts.js';
import type { StoreResult } from '../../kernel/store/contracts.js';
import type { ContextRole, ContextAudit, EvidenceLink } from './types.js';

/** Role aliases only. Visibility/partition rules remain exclusively in kernel/artifacts. */
export function audienceForRole(role: ContextRole): StoreResult<Audience> {
  switch (role) {
    case 'executor': case 'fresh-verifier': return storeOk('author');
    case 'private-evaluator': return storeOk('evaluator');
    case 'learner': return storeOk('asset-staging');
    default: return storeFail('EFK_SCHEMA_INVALID', 'unknown context role');
  }
}

export function evidenceLink(ref: ArtifactRef): EvidenceLink {
  return {
    id: ref.id, digest: ref.digest, visibility: ref.visibility, partition: ref.partition,
    schema: ref.schema, binding: ref.binding, expiresAt: ref.expiresAt,
    producer: { actorId: ref.producer.actorId, kind: ref.producer.kind },
  };
}

/** Codec failures may quote a bad enum containing private data. Do not forward that string. */
export function safeFailure<T>(result: Extract<StoreResult<T>, { ok: false }>): ReturnType<typeof storeFail> {
  return storeFail(result.error.code, 'context input rejected');
}

/**
 * Project every embedded ArtifactRef in a codec-validated TaskContract, including refs nested in
 * grants/degradations. Withheld refs become null (array slots are removed). Never serialize the
 * original contract digest: it commits to the withheld metadata too.
 */
export function projectTask(
  task: Readonly<Record<string, unknown>>, audience: Audience, at: number,
): StoreResult<{ task: Readonly<Record<string, unknown>>; audit: ContextAudit[]; visibility: number; partition: number }> {
  const audit: ContextAudit[] = [];
  let visibility = 0;
  let partition = 0;
  function visit(value: unknown): StoreResult<unknown> {
    if (value === null || typeof value !== 'object') return storeOk(value);
    if (Array.isArray(value)) {
      const projected: unknown[] = [];
      for (const item of value) {
        const next = visit(item);
        if (!next.ok) return next;
        if (next.value !== null || item === null) projected.push(next.value);
      }
      return storeOk(projected);
    }
    const record = value as Readonly<Record<string, unknown>>;
    // In the frozen TaskContract closure only ArtifactRef has a location field.
    if (Object.hasOwn(record, 'location')) {
      const ref = record as unknown as ArtifactRef;
      const reason = withheldReason(ref, audience);
      if (!reason.ok) return safeFailure(reason);
      if (reason.value !== 'none') {
        if (reason.value === 'visibility') visibility += 1;
        else partition += 1;
        return storeOk(null);
      }
      const available = checkAvailability(ref, at);
      if (!available.ok) return safeFailure(available);
      const link = evidenceLink(ref);
      audit.push({ ref: link, source: 'TaskContract', reason: 'visible-contract-reference' });
      return storeOk(link);
    }
    const projected: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const next = visit(item);
      if (!next.ok) return next;
      projected[key] = next.value;
    }
    return storeOk(projected);
  }
  const result = visit(task);
  if (!result.ok) return result;
  return storeOk({ task: result.value as Readonly<Record<string, unknown>>, audit, visibility, partition });
}

export { partitionFeedback, withheldReason };
