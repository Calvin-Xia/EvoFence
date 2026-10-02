import { readArtifact, withheldReason } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { immutable } from '../assets/identity.js';
import type { Experience, ExperiencePattern, PatternFacet, ProposalLimits, ProposalPorts, ProposalResult,
  TraceEvent, TraceSelection, VisibleTrace } from './types.js';

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
export function validateLimits(limits: ProposalLimits): ProposalResult<ProposalLimits> {
  const fields = ['maxTraces', 'maxTraceBytes', 'maxEvents', 'maxPatterns', 'maxCandidates', 'maxCandidateBytes',
    'maxTextChars', 'maxInputTokens', 'maxOutputTokens', 'maxGenerationRequests', 'maxGenerationMicros'];
  if (Object.keys(limits).length !== fields.length || fields.some(key =>
    !Number.isSafeInteger(limits[key as keyof ProposalLimits]) || limits[key as keyof ProposalLimits] <= 0)) {
    return storeFail('EFK_SCHEMA_INVALID', 'proposal limits must be explicit finite positive integers');
  }
  return storeOk(limits);
}
/** Only operational observations are projected. Messages, result bodies and terminal verdicts have no path out. */
function observation(row: Record<string, unknown>): { facet: PatternFacet; outcome: 'success' | 'failure'; label: string } | null {
  if (row.type === 'check' && typeof row.label === 'string' && Number.isSafeInteger(row.code)) {
    return { facet: 'visible-check', outcome: row.code === 0 ? 'success' : 'failure', label: row.label };
  }
  if (row.type === 'fatal') return { facet: 'session-recovery', outcome: 'failure', label: 'driver-failed' };
  if (row.type === 'same-session-recovery') return { facet: 'session-recovery', outcome: 'success', label: 'continuity-observed' };
  if (row.type === 'native-usage' && typeof row.complete === 'boolean' && typeof row.poolRecorded === 'boolean') {
    return { facet: 'usage-completeness', outcome: row.complete && row.poolRecorded ? 'success' : 'failure', label: 'usage-recorded' };
  }
  if (row.type === 'native-abort-ack' && typeof row.receiptStatus === 'string') {
    return { facet: 'cancel-confirmation', outcome: row.receiptStatus === 'cancelled' ? 'success' : 'failure', label: 'receipt-confirmation' };
  }
  return null;
}
export function extractExperience(
  selections: readonly TraceSelection[], limits: ProposalLimits, at: number, ports: ProposalPorts,
): ProposalResult<Experience> {
  const bounded = validateLimits(limits); if (!bounded.ok) return bounded;
  if (selections.length === 0 || selections.length > limits.maxTraces || new Set(selections.map(s => s.ref.id)).size !== selections.length) {
    return storeFail('EFK_SCHEMA_INVALID', 'trace selection must be nonempty, unique and bounded');
  }
  // Admit the complete selection before the first read, including both independent privacy axes.
  for (const selection of selections) {
    const allowed = withheldReason(selection.ref, 'asset-staging');
    if (!allowed.ok) return storeFail(allowed.error.code, 'trace selection rejected');
    if (allowed.value !== 'none') return storeFail('EFK_PRIVACY_VIOLATION', 'trace selection is not learner-visible');
    if (selection.ref.partition !== 'train') return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'source traces must belong to train');
    if (!['provider-live', 'native-fixture', 'unknown'].includes(selection.grade) ||
        typeof selection.whyVisible !== 'string' || selection.whyVisible.trim().length === 0 ||
        selection.whyVisible.length > limits.maxTextChars ||
        Object.keys(selection.scope).length !== 4 || ['projectId', 'hostId', 'modelId', 'taskId'].some(key => {
          const value = selection.scope[key as keyof typeof selection.scope];
          return typeof value !== 'string' || value.trim().length === 0 || value.length > limits.maxTextChars;
        })) return storeFail('EFK_SCHEMA_INVALID', 'trace selection requires explicit visibility, evidence grade and scope');
  }
  const traces: VisibleTrace[] = [];
  let totalEvents = 0;
  for (const selection of selections) {
    const read = readArtifact(selection.ref, 'asset-staging', at, ports.artifacts, selection.expectation);
    if (!read.ok) return storeFail(read.error.code, 'source trace admission failed');
    if (utf8Bytes(read.value) > limits.maxTraceBytes) return storeFail('EFK_SCHEMA_INVALID', 'trace byte limit exceeded');
    if (ports.digest.digest(read.value) !== selection.ref.digest) return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'trace bytes differ from the source pin');
    const lines = read.value.split(/\r?\n/); if (lines[lines.length - 1] === '') lines.pop();
    totalEvents += lines.length;
    if (totalEvents > limits.maxEvents) return storeFail('EFK_SCHEMA_INVALID', 'trace event limit exceeded');
    const events: TraceEvent[] = [];
    for (let index = 0; index < lines.length; index++) {
      let row: unknown;
      try { row = JSON.parse(lines[index]); }
      catch (error) {
        if (error instanceof SyntaxError) return storeFail('EFK_SCHEMA_INVALID', 'trace contains invalid JSONL');
        throw error;
      }
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return storeFail('EFK_SCHEMA_INVALID', 'trace event must be an object');
      const record = row as Record<string, unknown>;
      if (['private', 'held-out', 'final'].includes(record.visibility as string) || ['held-out', 'final'].includes(record.partition as string)) {
        return storeFail('EFK_PRIVACY_VIOLATION', 'trace contains a restricted event');
      }
      const observed = observation(record); if (observed === null) continue;
      if (observed.label.length > limits.maxTextChars) return storeFail('EFK_SCHEMA_INVALID', 'event label exceeds limit');
      events.push({ facet: observed.facet, label: observed.label, link: { traceId: selection.ref.id,
        traceDigest: selection.ref.digest, line: index + 1, eventDigest: ports.digest.digest(lines[index]),
        type: record.type as string, outcome: observed.outcome } });
    }
    traces.push({ ...selection, totalLines: lines.length, events });
  }
  const groups = new Map<string, ExperiencePattern>();
  for (const trace of traces) for (const event of trace.events) {
    const key = canonical({ scope: trace.scope, facet: event.facet });
    const previous = groups.get(key);
    const pattern = previous === undefined ? { patternId: ports.digest.digest(key), scope: trace.scope,
      facet: event.facet, successes: [], failures: [] } : previous;
    groups.set(key, { ...pattern, [event.link.outcome === 'success' ? 'successes' : 'failures']:
      [...(event.link.outcome === 'success' ? pattern.successes : pattern.failures), event.link] });
  }
  if (groups.size > limits.maxPatterns) return storeFail('EFK_SCHEMA_INVALID', 'pattern limit exceeded');
  const material = { traces, patterns: [...groups.values()].sort((a, b) => a.patternId < b.patternId ? -1 : 1), limits };
  return storeOk(immutable({ ...material, digest: ports.digest.digest(canonical(material)) }));
}
