/**
 * The JSON view shapes behind `evofence report`.
 *
 * DOMAIN: report/status views (L2 node `l2_report`).
 *
 * `src/types/report.ts` is the frozen, shared view contract and this module must not duplicate
 * it: {@link ReportView} *extends* the shared `EvolutionReport` and only adds the two view
 * classes node `l2_report` was asked to surface — gate verdicts (`gate_decisions`) and a
 * traceable ledger reference (`ledger`). Nothing here re-declares a shared field, so the two
 * layers cannot drift.
 *
 * `StatusView` is extended the same way in `src/lib/status.ts`.
 */
import type { EvolutionReport, Hash256Hex } from '../../types/index.js';

/**
 * One `report.gate_decisions` row: the decision part of a `gate.decision` event.
 *
 * Deliberately a PROJECTION, not the raw payload. The raw payload carries `failure`, `details`
 * and `requests` blobs, and the report is a publishable artifact (private-oracle output must
 * never leak into it — see the report's existing sanitization discipline). Only scalars that
 * describe the verdict are projected, plus the ledger `seq` so the row can be traced back.
 */
export interface ReportGateDecision {
  /** `null` when the decision was recorded without a run scope. */
  run_id: string | null;
  /** Ledger row reference: the `gate.decision` event this row was projected from. */
  seq: number;
  iteration: number | null;
  /** Kept open (`string`) because a tampered/legacy ledger can hold any value here. */
  decision: string;
  reason: string | null;
  /** Set on an iteration's FINAL decision only (`src/types/gate.ts` GateDecisionPayload). */
  evidence_ok: boolean | null;
  /** `payload.risk.band` when the risk gate attached a `RiskAssessment`. */
  risk_band: string | null;
  improvement: number | null;
  min_delta: number | null;
  /** `true`/`false`/count when the decision factored private regressions in. */
  private_regressions: boolean | number | null;
  /** `payload.failure.code` or `payload.failure.reason`, whichever is a string. */
  failure_code: string | null;
}

/**
 * `report.ledger`: the reference that ties this report to the event chain it was computed from.
 *
 * Every field is best-effort: a verification failure means the chain length/tip are unknown and
 * stay `null`, which is why they are nullable rather than optional — the keys are always present
 * so a consumer can rely on the shape (DoD 1).
 */
export interface ReportLedgerReference {
  /** Verified event count at the chain tip; `null` when the chain did not verify. */
  event_count: number | null;
  /** Chain tip digest (`LedgerChainValid.head`); `null` when unknown. */
  head_hash: Hash256Hex | null;
  /** `seq` of the oldest event behind this report; `null` when no events were readable. */
  first_seq: number | null;
  /** `seq` of the newest event behind this report; `null` when no events were readable. */
  last_seq: number | null;
  /** ISO timestamp of the snapshot read that produced this report. */
  read_at: string;
}

/** `buildEvolutionReport()` return value: the shared report contract plus the two new classes. */
export interface ReportView extends EvolutionReport {
  /** One row per `gate.decision` event, oldest first (門禁结论). */
  gate_decisions: ReportGateDecision[];
  /** Traceable reference into the ledger (账本引用). */
  ledger: ReportLedgerReference;
}
