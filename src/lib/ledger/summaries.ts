/**
 * `Ledger.recentRuns(limit)` — the sanitized run-summary view.
 *
 * Ported verbatim from `src/lib/ledger.js:158-216`. The view is a PUBLIC contract
 * (`docs/refactor-inventory.md` §8.1): it must never expose a prompt, a command, source text
 * or evaluator output, so it reads only `run.started` / `run.finished` / `run.failed` /
 * `candidate.*` / `gate.decision` payloads and emits nine counters.
 *
 * Two behaviours that tests lock and that must not drift:
 *   - `rejected_candidates` counts ITERATIONS, deduplicated: a `candidate.rejected` and a
 *     `gate.decision` REJECT in the same iteration count once.
 *   - `iterations` prefers the authoritative `run.finished` count; otherwise it is the highest
 *     observed iteration, so a failed run still reports how far it got.
 */

import type { RecentRunSummary } from '../../types/ledger.js';
import { EvoFenceError } from '../errors.js';
import type { SqliteDatabase } from './driver-types.js';

interface RunStartedRow {
  run_id: string;
  created_at: string;
  payload_json: string;
}

interface RunEventRow {
  seq: number;
  event_type: string;
  payload_json: string;
}

/** `Ledger.recentRuns(limit)`: newest first, `limit` restricted to 1..20. */
export function summarizeRuns(db: SqliteDatabase, limit = 10): RecentRunSummary[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new EvoFenceError('INVALID_RUN_LIMIT', 'Run summary limit must be an integer between 1 and 20.');
  }

  const runs = db.prepare<RunStartedRow>(`
    SELECT run_id, created_at, payload_json
    FROM events
    WHERE event_type = 'run.started' AND run_id IS NOT NULL
    ORDER BY seq DESC
    LIMIT ?
  `).all(limit);
  const runEvents = db.prepare<RunEventRow>(`
    SELECT seq, event_type, payload_json
    FROM events
    WHERE run_id = ?
    ORDER BY seq
  `);

  return runs.map((run) => {
    // Payloads are stored as raw JSON text and may be tampered with; a JSON-valid
    // payload is not guaranteed to be an object.
    const started = JSON.parse(run.payload_json) ?? {};
    const summary: RecentRunSummary = {
      run_id: run.run_id,
      started_at: run.created_at,
      adapter: typeof started.adapter === 'string' ? started.adapter : 'unknown',
      status: 'INCOMPLETE',
      accepted_candidates: 0,
      rejected_candidates: 0,
      iterations: 0,
    };
    const observedIterations = new Set<number>();
    const rejectedIterations = new Set<string>();
    let hasAuthoritativeIterations = false;

    for (const event of runEvents.all(run.run_id)) {
      const payload = JSON.parse(event.payload_json) ?? {};
      if (Number.isInteger(payload.iteration) && payload.iteration > 0) observedIterations.add(payload.iteration);

      if (
        event.event_type === 'candidate.rejected'
        || (event.event_type === 'gate.decision' && payload.decision === 'REJECT')
      ) {
        const iterationKey = Number.isInteger(payload.iteration) && payload.iteration > 0
          ? `iteration:${payload.iteration}`
          : `event:${event.seq}`;
        rejectedIterations.add(iterationKey);
      }

      if (event.event_type === 'candidate.accepted') summary.accepted_candidates += 1;
      else if (event.event_type === 'run.finished') {
        summary.status = typeof payload.status === 'string' ? payload.status : 'FINISHED';
        if (Number.isInteger(payload.iterations) && payload.iterations >= 0) {
          summary.iterations = payload.iterations;
          hasAuthoritativeIterations = true;
        }
        if (Number.isFinite(payload.duration_ms) && payload.duration_ms >= 0) summary.duration_ms = payload.duration_ms;
      } else if (event.event_type === 'run.failed') {
        summary.status = 'FAILED';
      }
    }

    summary.rejected_candidates = rejectedIterations.size;
    if (!hasAuthoritativeIterations) summary.iterations = observedIterations.size ? Math.max(...observedIterations) : 0;
    return summary;
  });
}
