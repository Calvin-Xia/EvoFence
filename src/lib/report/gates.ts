/**
 * `report.gate_decisions`: the four gates' verdicts, projected from the `gate.decision` events.
 *
 * DOMAIN: report views (L2 node `l2_report`). NEW in this node — 0.3.0's report carried run
 * summaries but no gate conclusions, so a reader could not answer "what did the gate decide, and
 * why?" from the report alone (DoD 1: 门禁结论).
 *
 * The projection is intentionally narrow: the raw `gate.decision` payload also carries `failure`,
 * `details` and `requests` blobs that may embed private-oracle output, and the report is a
 * publishable artifact. Only scalars describing the verdict are copied, plus the ledger `seq` so
 * every row is traceable.
 *
 * Rows are emitted oldest first (the ledger's own `seq` order). Several decisions exist per
 * iteration — early ones (worktree metadata, policy drift, capability denial, pre-commit
 * validation) carry `failure`/`reason` and only the iteration's FINAL decision carries
 * `evidence_ok` — so the report keeps them all instead of collapsing to the last one.
 */
import type { LedgerEvent } from '../../types/index.js';
import { booleanOrFiniteNumber, failureCodeOf, finiteNumber, iterationOf, payloadObject, riskBandOf } from './ledger-view.js';
import type { ReportGateDecision } from './view.js';

export function buildGateDecisions(events: LedgerEvent[]): ReportGateDecision[] {
  const decisions: ReportGateDecision[] = [];
  for (const event of events) {
    if (event.event_type !== 'gate.decision') continue;
    const payload = payloadObject(event.payload) ?? {};
    decisions.push({
      run_id: typeof event.run_id === 'string' ? event.run_id : null,
      seq: event.seq,
      iteration: iterationOf(event.payload),
      decision: typeof payload.decision === 'string' ? payload.decision : 'UNKNOWN',
      reason: typeof payload.reason === 'string' ? payload.reason : null,
      evidence_ok: typeof payload.evidence_ok === 'boolean' ? payload.evidence_ok : null,
      risk_band: riskBandOf(payload.risk),
      improvement: finiteNumber(payload.improvement),
      min_delta: finiteNumber(payload.min_delta),
      private_regressions: booleanOrFiniteNumber(payload.private_regressions),
      failure_code: failureCodeOf(payload.failure),
    });
  }
  return decisions;
}
