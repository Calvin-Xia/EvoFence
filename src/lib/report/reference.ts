/**
 * `report.ledger`: the reference that ties a report back to the event chain it came from.
 *
 * DOMAIN: report views (L2 node `l2_report`). NEW in this node (DoD 1: 账本引用).
 *
 * Every field is best-effort by design. A broken chain or an unreadable payload means the chain
 * length and tip are genuinely unknown, so they are reported as `null` rather than guessed — a
 * fabricated reference is worse than an absent one, because the report's `run_count`/
 * `generation_count` are also suppressed in those cases.
 */
import type { LedgerEvent } from '../../types/index.js';
import type { ReportLedgerReference } from './view.js';

export interface LedgerReferenceInput {
  /**
   * The `LedgerVerification` arm, widened on purpose: the valid arm carries `events`/`head`, the
   * invalid arm does not, and test doubles may omit both even when they report `valid: true`.
   */
  integrity: { valid: boolean } & Partial<Record<'events' | 'head', unknown>>;
  /** The events behind the view, when they were readable; `undefined`/`[]` otherwise. */
  events?: LedgerEvent[];
  /** ISO timestamp of the read that produced the view. */
  read_at: string;
}

export function buildLedgerReference({ integrity, events, read_at }: LedgerReferenceInput): ReportLedgerReference {
  const readable = events ?? [];
  const seqs = readable.map((event) => event.seq).filter((seq) => Number.isInteger(seq));
  const eventCount = Number.isInteger(integrity.events)
    ? (integrity.events as number)
    : integrity.valid ? readable.length : null;
  return {
    event_count: eventCount,
    head_hash: typeof integrity.head === 'string' ? integrity.head : null,
    first_seq: seqs.length ? Math.min(...seqs) : null,
    last_seq: seqs.length ? Math.max(...seqs) : null,
    read_at,
  };
}
