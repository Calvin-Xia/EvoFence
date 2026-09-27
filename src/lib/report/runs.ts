/**
 * `report.runs`: one summary row per `run.started`, newest first.
 *
 * DOMAIN: report views (L2 node `l2_report`). Ported 1:1 from `src/lib/report.js`'s
 * `summarizeRuns`; the newest-first order and the `INCOMPLETE` sentinel are locked by spec-f2.
 */
import type { LedgerEvent, ReportRunSummary } from '../../types/index.js';
import { iterationOf, payloadObject } from './ledger-view.js';

export function summarizeRuns(events: LedgerEvent[]): ReportRunSummary[] {
  const eventsByRun = new Map<string, LedgerEvent[]>();
  for (const event of events) {
    if (event.run_id === null || event.run_id === undefined) continue;
    if (!eventsByRun.has(event.run_id)) eventsByRun.set(event.run_id, []);
    eventsByRun.get(event.run_id)!.push(event);
  }

  const started = events.filter((event) => event.event_type === 'run.started' && event.run_id);
  return started.reverse().map((startedEvent) => {
    const startedPayload = payloadObject(startedEvent.payload) ?? {};
    const summary: ReportRunSummary = {
      run_id: startedEvent.run_id as string,
      started_at: startedEvent.created_at,
      adapter: typeof startedPayload.adapter === 'string' ? startedPayload.adapter : 'unknown',
      status: 'INCOMPLETE',
      iterations: 0,
      accepted_candidates: 0,
      rejected_candidates: 0,
    };
    const observedIterations = new Set<number>();
    const rejectedIterations = new Set<string>();
    let hasAuthoritativeIterations = false;

    for (const event of eventsByRun.get(startedEvent.run_id as string) ?? []) {
      const payload = payloadObject(event.payload) ?? {};
      const iteration = iterationOf(event.payload);
      if (iteration !== null) observedIterations.add(iteration);

      if (
        event.event_type === 'candidate.rejected'
        || (event.event_type === 'gate.decision' && payload.decision === 'REJECT')
      ) {
        rejectedIterations.add(iteration !== null ? `iteration:${iteration}` : `event:${event.seq}`);
      }

      if (event.event_type === 'candidate.accepted') summary.accepted_candidates += 1;
      else if (event.event_type === 'run.finished') {
        summary.status = typeof payload.status === 'string' ? payload.status : 'FINISHED';
        if (Number.isInteger(payload.iterations) && (payload.iterations as number) >= 0) {
          summary.iterations = payload.iterations as number;
          hasAuthoritativeIterations = true;
        }
      } else if (event.event_type === 'run.failed') {
        // Failed and resource-exhausted runs must not read as interrupted runs
        // (status stays INCOMPLETE only when no terminal run event exists).
        summary.status = 'FAILED';
        if (typeof payload.code === 'string') summary.failure_code = payload.code;
      }
    }

    summary.rejected_candidates = rejectedIterations.size;
    if (!hasAuthoritativeIterations) summary.iterations = observedIterations.size ? Math.max(...observedIterations) : 0;
    return summary;
  });
}
