/**
 * Exec domain · internal result shapes shared by the runner submodules.
 *
 * The public contracts live in `src/types/exec.ts`; these aliases only describe the loose
 * objects the ledger/audit paths consume (tests and the audit view pass partial records), so
 * the domain keeps a single upstream type dependency instead of re-declaring fields everywhere.
 */
import type { AdapterUsage, AdapterUsageSnapshot, PiToolStrategySummary, ProcessResult } from '../../types/index.js';

/** Complete-or-partial usage record attached to an adapter result or a fixture. */
export type AdapterUsageLike = Partial<AdapterUsage> & Partial<AdapterUsageSnapshot>;

/** The subset of an adapter result the budget/event helpers read. */
export interface AdapterResultLike extends Partial<ProcessResult> {
  model?: string | null;
  duration_ms?: number | null;
  estimated_tokens?: number | null;
  budget_stop_reason?: string | null;
  cost_budget_reached?: boolean;
  reported_usage?: AdapterUsageLike | null;
  tool_strategy?: PiToolStrategySummary | null;
}
