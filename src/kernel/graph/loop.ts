/**
 * Bounded loops (`SEMANTICS.md §4`).
 *
 * The loop is explicit: `loop.bodyNodeIds` names the body, and at least two of the four bound kinds
 * must be declared (the frozen schema's `allOf` enforces that at decode time, so there is one gate
 * and this module reads the declaration rather than re-checking it).
 *
 * The recovery rule is the load-bearing one: a loop resumes at the last persisted iteration
 * boundary, so settled iterations are never replayed and never re-billed. That is expressed by
 * keeping consumption cumulative and making `resumeLoop` return the settled count as the next
 * iteration index — there is no code path that restarts from zero.
 */
import type { LoopSpec } from './types.js';

/** The four bound kinds a loop may declare; at least two are required by the frozen schema. */
export type LoopBoundKind = 'maxIterations' | 'maxWallClock' | 'maxTokensOrCost' | 'maxDepth';

/** Which of the four bound kinds this loop declares (declaration order, stable). */
export function loopBoundKinds(loop: LoopSpec): readonly LoopBoundKind[] {
  const kinds: LoopBoundKind[] = [];
  if (loop.maxIterations !== undefined) kinds.push('maxIterations');
  if (loop.maxWallClock !== undefined) kinds.push('maxWallClock');
  if (loop.maxTokensOrCost !== undefined) kinds.push('maxTokensOrCost');
  if (loop.maxDepth !== undefined) kinds.push('maxDepth');
  return kinds;
}

/** Cumulative loop consumption; nothing here is per-iteration or reset on a new attempt. */
export interface LoopProgress {
  readonly iterations: number;
  readonly wallClockMs: number;
  readonly tokens: number;
  readonly usdMicros: number;
}

/** What one finished iteration added, in the same units as the loop bounds. */
export interface IterationDelta {
  readonly wallClockMs: number;
  readonly tokens: number;
  readonly usdMicros: number;
}

/** Settle one finished iteration onto the cumulative ledger. */
export function settleIteration(progress: LoopProgress, delta: IterationDelta): LoopProgress {
  return {
    iterations: progress.iterations + 1,
    wallClockMs: progress.wallClockMs + delta.wallClockMs,
    tokens: progress.tokens + delta.tokens,
    usdMicros: progress.usdMicros + delta.usdMicros,
  };
}

/** The first bound the cumulative ledger has reached, or `null` while the loop may continue. */
export function exhaustedBound(loop: LoopSpec, progress: LoopProgress): LoopBoundKind | null {
  if (loop.maxIterations !== undefined && progress.iterations >= loop.maxIterations) return 'maxIterations';
  if (loop.maxWallClock !== undefined && progress.wallClockMs >= loop.maxWallClock) return 'maxWallClock';
  if (loop.maxTokensOrCost !== undefined) {
    const { tokens, usdMicros } = loop.maxTokensOrCost;
    if (tokens !== null && progress.tokens >= tokens) return 'maxTokensOrCost';
    if (usdMicros !== null && progress.usdMicros >= usdMicros) return 'maxTokensOrCost';
  }
  return null;
}

/** Recovery: resume at the settled boundary; the cumulative ledger carries over unchanged. */
export function resumeLoop(progress: LoopProgress): { readonly iteration: number; readonly progress: LoopProgress } {
  return { iteration: progress.iterations, progress };
}

export interface LoopBody {
  readonly succeeded: boolean;
  readonly irreparable: boolean;
}

export type LoopStop =
  | { readonly stop: 'body-success' | 'irreparable-failure' | 'bound-exhausted'; readonly bound: LoopBoundKind | null }
  | { readonly stop: 'continue' };

/**
 * Evaluate the loop's stop condition over the cumulative ledger. `stop` lists only the stops the
 * loop permits; an unlisted condition cannot end it. Bounds win over body success so a limit is
 * never overshot.
 */
export function loopStop(loop: LoopSpec, progress: LoopProgress, body: LoopBody): LoopStop {
  const allowed = (kind: LoopSpec['stop'][number]): boolean => loop.stop.includes(kind);
  const bound = exhaustedBound(loop, progress);
  if (bound !== null && allowed('bound-exhausted')) return { stop: 'bound-exhausted', bound };
  if (body.succeeded && allowed('body-success')) return { stop: 'body-success', bound: null };
  if (body.irreparable && allowed('irreparable-failure')) return { stop: 'irreparable-failure', bound: null };
  return { stop: 'continue' };
}
