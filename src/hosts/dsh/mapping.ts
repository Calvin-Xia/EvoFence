/** Lossless token accounting and read-only native board interpretation. */
import { decode, fail } from '../../protocol/index.js';
import { DSH_CAPABILITIES, dedupeUsage, err, ok, verifyBoardAuthority, type BoardOwner, type Effect, type HostObservation, type HostResult, type Usage } from '../../runtime/host-port/index.js';
import type { DshComposition, DshSession, NativeEvent, NativeTask, NativeUsage } from './types.js';

export function identity(composition: DshComposition, prefix: string, value: unknown): string {
  return `${prefix}:${composition.ports.digest.digest(JSON.stringify(value)).slice(7)}`;
}
export function nativeUsage(requestId: string, raw: NativeUsage | undefined, source: Usage['source']): HostResult<Usage> {
  const inputUncached = raw?.inputTokens ?? null;
  const output = raw?.outputTokens ?? null;
  const cacheRead = raw?.cacheReadTokens ?? null;
  const cacheWrite = raw?.cacheWriteTokens ?? null;
  const total = raw?.totalTokens ?? null;
  const reasoning = raw?.reasoningTokens ?? null;
  const complete = inputUncached !== null && output !== null && cacheRead !== null && cacheWrite !== null && total !== null;
  const row = decode('Usage', { requestId, source, inputUncached, output, cacheRead, cacheWrite, total, reasoning,
    estimatedUsdMicros: null, invoiceUsdMicros: null, complete, evidenceRefs: [] });
  if (!row.ok) return row;
  if ((complete && total !== inputUncached + cacheRead + cacheWrite + output)
    || (reasoning !== null && output !== null && reasoning > output)) {
    return err(fail('EFK_USAGE_CONFLICT', 'native disjoint token counters do not agree', [requestId]));
  }
  return row;
}
/** Durable settlement sequence identifies an invocation across a native resume. */
export function invocationUsage(session: DshSession, composition: DshComposition, events: readonly NativeEvent[]): HostResult<readonly Usage[]> {
  const rows: Usage[] = [];
  for (const event of events) {
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
    const requestId = identity(composition, 'dsh-request', [session.agent.id, event.seq]);
    const row = nativeUsage(requestId, event.data.usage, composition.usageSource);
    if (!row.ok) return row;
    rows.push(row.value);
  }
  return dedupeUsage(rows);
}
/** The L2 runtime reserves one request per effect. Never hide extra native requests in that slot. */
export function reservedUsage(effect: Effect, rows: readonly Usage[]): readonly Usage[] {
  if (rows.length !== 1 || effect.reservationRef === null) return [];
  return [{ ...rows[0], requestId: effect.reservationRef }];
}
export function nativeBoard(session: DshSession): HostResult<readonly BoardOwner[]> {
  const tasks = new Map<string, NativeTask>();
  for (const event of session.agent.session.snapshotEvents()) {
    if (event.type === 'team/task' && event.data.task !== undefined) tasks.set(event.data.task.id, event.data.task);
  }
  const owners: BoardOwner[] = [];
  for (const task of tasks.values()) {
    if (task.status === 'deleted' || task.ownerId === undefined) continue;
    const link = session.boardLinks.get(task.id);
    if (link === undefined || link.ownerSessionId !== task.ownerId) {
      return err(fail('EFK_HOST_BOARD_AUTHORITY_CONFLICT', 'native board owner has no exact kernel projection mapping', [task.id]));
    }
    owners.push({ nodeId: link.nodeId, attemptId: link.attemptId, ownerClaimId: link.ownerClaimId });
  }
  const read = session.runtime.read(session.request.sessionId);
  if (!read.ok) return read;
  const unknown = { status: 'unknown' as const, coverage: [], evidenceRefs: [] };
  const observation: HostObservation = { host: 'dsh', boardOwners: owners, idle: session.agent.status === 'idle',
    capabilities: DSH_CAPABILITIES, cancellation: unknown, recovery: unknown, isolation: unknown };
  const judged = verifyBoardAuthority(observation, read.value.scheduler.claims.map(c => ({ nodeId: c.binding.nodeId,
    attemptId: c.binding.attemptId, ownerClaimId: c.claimId })));
  return judged.ok ? ok(owners) : judged;
}
