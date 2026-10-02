/** Actual child transcript -> receipts. Enqueue alone never settles an invocation. */
import { fail } from '../../protocol/index.js';
import { dedupeUsage, err, ok, type HostResult, type Receipt, type Usage } from '../../runtime/host-port/index.js';
import { identity, nativeUsage, reservedUsage } from './mapping.js';
import type { ChildEvidence, DelegationPorts, DelegationRecord } from './delegation-types.js';

export function save(ports: DelegationPorts, record: DelegationRecord, changes: Partial<DelegationRecord>): HostResult<DelegationRecord> {
  const next = { ...record, ...changes, revision: record.revision + 1 };
  const stored = ports.store.put(next, record.revision);
  return stored.ok ? ok(next) : stored;
}
export function childUsage(ports: DelegationPorts, record: DelegationRecord, child: ChildEvidence): HostResult<readonly Usage[]> {
  if (child.id !== record.childId) return err(fail('EFK_HOST_SESSION_MISMATCH', 'transcript belongs to another native child', [child.id]));
  const rows: Usage[] = [];
  for (const event of child.events.filter(e => e.seq >= record.fromSeq)) {
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
    const row = nativeUsage(identity(ports.composition, 'dsh-child-request', [child.id, event.seq]),
      event.data.usage, ports.composition.usageSource);
    if (!row.ok) return row;
    rows.push(row.value);
  }
  return dedupeUsage(rows);
}
export function makeReceipt(ports: DelegationPorts, record: DelegationRecord, status: Receipt['status'],
  invocation: string | null, usage: readonly Usage[], observability: readonly string[], error: Receipt['error'],
  artifacts: Receipt['artifactRefs'] = []): Receipt {
  const effect = record.effect;
  return { protocol: effect.protocol, receiptId: identity(ports.composition, 'dsh-delegation-receipt',
    [effect.effectId, status, invocation, usage, observability, error, artifacts]), effectId: effect.effectId, hostInvocationId: invocation,
    binding: effect.binding, status, artifactRefs: artifacts, usage: reservedUsage(effect, usage), observability, error };
}
export function inspectChild(ports: DelegationPorts, record: DelegationRecord, child: ChildEvidence): HostResult<Receipt> {
  const events = child.events.filter(e => e.seq >= record.fromSeq);
  const rows = childUsage(ports, record, child);
  if (!rows.ok) return rows;
  const end = events.findLast(e => e.type === 'turn/end');
  const invoked = events.filter(e => e.type === 'assistant/message' || e.type === 'assistant/attempt');
  const invocation = invoked.length === 1 ? identity(ports.composition, 'dsh-child-invocation', [child.id, invoked[0].seq]) : null;
  const evidence = events.map(e => identity(ports.composition, 'dsh-child-event', [child.id, e.seq]));
  if (record.messageId !== null) evidence.push(`durable-enqueue:${record.messageId}`);
  // External transcripts can contain extra ordinary turns or omit a consumption ack.
  const consumed = record.messageId === null || events.some(e => {
    const data = e.data as { source?: { kind?: string; messageId?: string } };
    return e.type === 'user/message' && data.source?.kind === 'team-message' && data.source.messageId === record.messageId;
  });
  const covered = record.preSteps === 1 && !record.unconfirmed && events.every(e => e.type !== 'tool/call'
    || (record.gatedCalls.includes(e.data.callId!) && record.resultCalls.includes(e.data.callId!)));
  if (!child.idle || end === undefined || invocation === null || !consumed || !covered) {
    return ok(makeReceipt(ports, record, 'unknown', invocation, rows.value, evidence,
      fail('EFK_EFFECT_UNKNOWN', 'child outcome or scoped hook coverage is unconfirmed', [record.effect.effectId])));
  }
  const status = end.data.reason?.kind === 'completed' ? 'completed' : end.data.reason?.kind === 'aborted' ? 'cancelled'
    : end.data.reason?.kind === 'error' ? 'failed' : 'unknown';
  const products = status === 'completed' ? ports.collect(child, record.effect, record.grant) : ok([]);
  if (!products.ok) return products;
  const error = status === 'failed' ? fail('EFK_HOST_EXECUTION_FAILED', 'native child turn failed', [child.id])
    : status === 'unknown' ? fail('EFK_EFFECT_UNKNOWN', 'native child termination is unconfirmed', [child.id]) : null;
  return ok(makeReceipt(ports, record, status, invocation, rows.value, evidence, error, products.value));
}
export function unknownReceipt(ports: DelegationPorts, record: DelegationRecord): Receipt {
  return makeReceipt(ports, record, 'unknown', null, [], record.messageId === null ? [] : [`durable-enqueue:${record.messageId}`],
    fail('EFK_EFFECT_UNKNOWN', 'native delegation dispatch needs reconciliation; no replay', [record.effect.effectId]));
}
