/**
 * Ledger-domain contracts: event rows, the hash chain, generations and read views.
 *
 * DERIVED FROM: the DDL and read/write methods in `src/lib/ledger.js` (`docs/refactor-inventory.md`
 * §4.1-§4.4), and the 22 event-type literals actually appended across `src/lib/ledger.js` and
 * `src/lib/runner.js` (§4.2). Nothing here is designed; every field name is a column name or a
 * property name returned by an existing method.
 *
 * THE HASH CHAIN IS THE HIGHEST-RISK SURFACE (§10.1). {@link LedgerEventRecord} mirrors the
 * `events` table column-for-column and in column order, because `eventHash` hashes exactly six
 * of those columns through `stableStringify`, which sorts keys — adding, renaming or reordering
 * a column silently breaks every existing ledger.
 */

import type { Hash256Hex, JsonValue, RepoRelativePath, RunSummaryStatus } from './shared.js';

/** Re-exported so ledger-only consumers do not need a second import. */
export { ZERO_HASH } from './shared.js';

/**
 * Every `event_type` EvoFence can append (22 values, `docs/refactor-inventory.md` §4.2).
 * 0.3.0 has no shared constant module — these are string literals at each call site; this
 * array becomes the single source of truth for the L2 ledger domain.
 */
export const LEDGER_EVENT_TYPES = [
  'run.started',
  'run.finished',
  'run.failed',
  'prompt.prepared',
  'proposal.created',
  'claims.created',
  'evidence.baseline',
  'evidence.candidate',
  'gate.decision',
  'capability.denied',
  'candidate.accepted',
  'candidate.rejected',
  'adapter.finished',
  'budget.tokens.observed',
  'budget.usd.observed',
  'budget.exhausted',
  'budget.usage_unavailable',
  'budget.cost_usage_unavailable',
  'budget.termination_failed',
  'process.tree_termination_failed',
  'generation.accepted',
  'generation.rollback',
] as const;

export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

/**
 * The six columns `eventHash` hashes, in the order `stableStringify` will sort them
 * (`created_at, event_type, payload_json, previous_hash, run_id, seq`). `event_hash` is the
 * output and must never be an input (§4.4 reproduction note 1).
 */
export interface EventHashInput {
  /** `INTEGER PRIMARY KEY`, assigned as `(latest?.seq ?? 0) + 1`. */
  seq: number;
  /** `new Date().toISOString()` — millisecond precision, UTC, trailing `Z`. Hashed as-is. */
  created_at: string;
  event_type: LedgerEventType;
  run_id: string | null;
  /** `stableStringify(payload)`; hashed as the raw string, never re-serialized. */
  payload_json: string;
  /** Previous row's `event_hash`, or {@link ZERO_HASH} for `seq === 1`. */
  previous_hash: Hash256Hex;
}

/** A row of the `events` table, column names as returned by `SELECT *`. */
export interface LedgerEventRecord extends EventHashInput {
  /** SHA-256 of `stableStringify(EventHashInput)`. Carries a `UNIQUE` constraint. */
  event_hash: Hash256Hex;
}

/**
 * A row plus its parsed payload, as returned by `Ledger.events()`.
 *
 * `payload` is deliberately {@link JsonValue} rather than an object: `payload_json` is a raw
 * TEXT column, so a tampered or legacy ledger can hold a scalar or an array, and `report`/
 * `status` are written to expect exactly that (§10.4 "payload_json 可能被篡改/非对象").
 */
export interface LedgerEvent extends LedgerEventRecord {
  payload: JsonValue;
}

/** A row of the `generations` table (§4.1). */
export interface GenerationRecord {
  generation_id: string;
  run_id: string;
  sha: string;
  parent_sha: string;
  created_at: string;
}

/** `Ledger.verify()` success arm (§4.4). */
export interface LedgerChainValid {
  valid: true;
  /** Total event count in the verified chain. */
  events: number;
  /** `event_hash` of the last row; the tip of the chain. */
  head: Hash256Hex;
}

/** `Ledger.verify()` failure arm — the FIRST failing row only. */
export interface LedgerChainInvalid {
  valid: false;
  /** `row.seq`, i.e. where the chain broke. */
  sequence: number;
  /** The digest that row should have pointed at. */
  expected_previous_hash: Hash256Hex;
  /** The digest the row actually carries. */
  observed_hash: Hash256Hex;
}

export type LedgerVerification = LedgerChainValid | LedgerChainInvalid;

/**
 * `Ledger.readSnapshot()`: chain verification plus both reads inside ONE SQLite transaction,
 * so the three views always describe the same ledger state (§4.4). `events` is empty when the
 * chain is invalid — unparseable payloads are never touched.
 */
export interface LedgerSnapshot {
  integrity: LedgerVerification;
  events: LedgerEvent[];
  generations: GenerationRecord[];
}

/** `Ledger.export()` bundle (`{ schema_version: 1, ... }`). */
export interface LedgerExport {
  schema_version: 1;
  integrity: LedgerVerification;
  active_generation: GenerationRecord | null;
  generations: GenerationRecord[];
  events: LedgerEvent[];
}

/**
 * One entry of `Ledger.recentRuns(limit)` (§8.1 "不得包含 prompt/命令/源码/评估输出"):
 * this view is sanitized and must stay that way.
 */
export interface RecentRunSummary {
  run_id: string;
  started_at: string;
  /** Falls back to the literal `'unknown'` when the `run.started` payload has no adapter string. */
  adapter: string;
  status: RunSummaryStatus;
  /** Only present when a `run.finished` payload carried a finite, non-negative `duration_ms`. */
  duration_ms?: number;
  /** Use `payload.iterations` when authoritative, otherwise the highest observed iteration. */
  iterations: number;
  accepted_candidates: number;
  rejected_candidates: number;
}

/** `Ledger.schemaTables()` — the three tables EvoFence owns. */
export type LedgerTableName = 'events' | 'generations' | 'state';

/** Fixed key of the single upsertable row in the `state` table (no append-only trigger). */
export const ACTIVE_GENERATION_STATE_KEY = 'active_generation';

/** The `state` table is the only mutable table; it is keyed by `key`. */
export interface LedgerStateRow {
  key: typeof ACTIVE_GENERATION_STATE_KEY;
  value: string;
}

/** Artifact reference written by the evidence gate, relative to the repository root. */
export type ArtifactPath = RepoRelativePath;
