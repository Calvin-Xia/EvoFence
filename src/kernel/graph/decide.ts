/**
 * `decide(event) -> { nodeState, graphActions }` — the single judgement entry point.
 *
 * Every rule of `SEMANTICS.md §3.0.2` lives here and nowhere else: event A (`onOutcome`, A1–A6) and
 * event B (`onUpstreamTerminal`, B1–B3), plus the `INV` assertion. Readiness, joins and the tests do
 * not re-derive "does a route match" or "is there cover" with their own `if`s; they call this.
 *
 * Two layers are kept apart on purpose. `nodeState` is what `N` becomes, `graphActions` is what the
 * graph may advance — so A3/A4 leave `N` `failed` while still enabling a target, and the failure
 * evidence is never rewritten into success.
 *
 * `INV` is the one unreachable-on-a-compiled-graph branch: check 10 rejects non-terminal nodes
 * without a real consumer. It fires only when a caller hands in a plan that bypassed acceptance, and
 * then it alarms and leaves the node where it was instead of inventing a `failed` state.
 */
import { fail } from '../../protocol/index.js';
import { hasBlockingConsumer, hasDeclaredCover, hasRoutingOutgoing, matchingOutgoing } from './edges.js';
import type { PredicateEnv } from './predicate.js';
import {
  type ArtifactRef,
  type Binding,
  type BranchEvidence,
  type DecideEvent,
  type DecidePlan,
  type DecideResult,
  type DecideRule,
  type GraphAction,
  type NodeOutcome,
  type NodeState,
  type TaskOutcome,
} from './types.js';

/** The predicate inputs for one binding. Only these roots are readable (`INTERFACES.md §4`). */
export function outcomeEnv(outcome: NodeOutcome, env: Readonly<Record<string, unknown>> = {}): PredicateEnv {
  return {
    outcome: outcome.decision,
    reason: outcome.reason,
    self: { failed: !outcome.ok, reason: outcome.reason },
    decision: { outcome: outcome.decision },
    env,
  };
}

/** How a `TaskDecision` outcome resolves `verifying` (`SEMANTICS.md §2.2`). */
export function stateFromDecision(decision: TaskOutcome): NodeState {
  switch (decision) {
    case 'completed':
      return 'succeeded';
    case 'repair':
    case 'failed':
      return 'failed';
    case 'needs-human':
      return 'waiting';
    case 'unknown':
      return 'unknown';
  }
}

function enable(nodeId: string): GraphAction {
  return { kind: 'enable', nodeId };
}

function decide(plan: DecidePlan, event: DecideEvent): DecideResult {
  return event.kind === 'outcome' ? decideOutcome(plan, event) : decideUpstream(plan, event);
}

function resolved(rule: DecideRule, outcome: NodeOutcome, actions: readonly GraphAction[]): DecideResult {
  if (!outcome.ok) {
    return { rule, nodeState: 'failed', reason: outcome.reason, graphActions: actions, gap: null, violation: null };
  }
  return { rule, nodeState: stateFromDecision(outcome.decision), reason: null, graphActions: actions, gap: null, violation: null };
}

/** Event A (`onOutcome`): rules A1–A6 in the frozen order, then `INV`. */
function decideOutcome(plan: DecidePlan, event: Extract<DecideEvent, { kind: 'outcome' }>): DecideResult {
  const node = plan.node(event.nodeId);
  const edges = plan.edgesFrom(event.nodeId);
  const env = outcomeEnv(event.outcome);

  if (node !== undefined && node.terminal) return resolved('A1', event.outcome, []);

  const route = matchingOutgoing(edges, 'route', env);
  if (route !== undefined) return resolved('A2', event.outcome, [enable(route.to)]);

  const repair = matchingOutgoing(edges, 'repair', env);
  if (repair !== undefined) {
    return {
      rule: 'A3',
      nodeState: 'failed',
      reason: event.outcome.reason,
      graphActions: [
        { kind: 'new-attempt', nodeId: repair.to, previousReason: event.outcome.reason },
        enable(repair.to),
      ],
      gap: null,
      violation: null,
    };
  }

  const fallback = matchingOutgoing(edges, 'fallback', env);
  if (fallback !== undefined) {
    return { rule: 'A4', nodeState: 'failed', reason: event.outcome.reason, graphActions: [enable(fallback.to)], gap: null, violation: null };
  }

  if (hasRoutingOutgoing(edges)) {
    return { rule: 'A5', nodeState: 'failed', reason: 'no-matching-route', graphActions: [], gap: null, violation: null };
  }

  if (hasBlockingConsumer(edges)) return resolved('A6', event.outcome, []);

  return {
    rule: 'INV',
    nodeState: event.state,
    reason: null,
    graphActions: [],
    gap: null,
    violation: fail('EFK_INVARIANT_VIOLATION', `node ${event.nodeId} has no real consumer and is not terminal`),
  };
}

/** Event B (`onUpstreamTerminal`): B1 (cover) before B2 (abandoned), B3 otherwise. */
function decideUpstream(plan: DecidePlan, event: Extract<DecideEvent, { kind: 'upstream-terminal' }>): DecideResult {
  const gap = { kind: 'upstream-terminal' as const, node: event.upstreamId, at: event.seq };
  if (hasDeclaredCover(plan.edgesTo(event.upstreamId), event.upstreamId)) {
    return { rule: 'B1', nodeState: 'waiting', reason: null, graphActions: [], gap, violation: null };
  }
  if (plan.isAbandoned(event.upstreamId)) {
    return { rule: 'B2', nodeState: 'failed', reason: 'upstream-abandoned', graphActions: [], gap: null, violation: null };
  }
  return { rule: 'B3', nodeState: 'waiting', reason: null, graphActions: [], gap, violation: null };
}

export { decide };

/** Runtime facts for one join branch; `null` state means the branch never reported. */
export interface BranchFacts {
  readonly state: NodeState | null;
  readonly binding: Binding | null;
  readonly artifactRefs: readonly ArtifactRef[];
  readonly decisionRef: ArtifactRef | null;
  readonly gapReason: string | null;
}

export interface JoinInput {
  readonly seq: number;
  readonly branches: ReadonlyMap<string, BranchFacts>;
}

export interface JoinEvaluation {
  readonly status: 'verifying' | 'waiting' | 'failed';
  readonly requiredBranches: readonly string[];
  /** One entry per required branch, in declaration order — never filtered (S20/A11). */
  readonly branchReport: readonly BranchEvidence[];
  readonly rules: readonly DecideRule[];
  readonly violation: ReturnType<typeof fail> | null;
}

/**
 * Fan-in via the same `decide` entry: each non-`succeeded` branch is fed to event B. A `B2`
 * (abandoned, no cover) makes the join `failed`; any other gap makes it `waiting`; all-`succeeded`
 * makes it `verifying`. The report always covers exactly `requiredBranches`.
 */
export function evaluateJoin(plan: DecidePlan, joinId: string, input: JoinInput): JoinEvaluation {
  const node = plan.node(joinId);
  if (node === undefined || node.kind !== 'join') {
    return {
      status: 'failed',
      requiredBranches: [],
      branchReport: [],
      rules: ['INV'],
      violation: fail('EFK_INVARIANT_VIOLATION', `${joinId} is not a declared join node`),
    };
  }

  const report: BranchEvidence[] = [];
  const rules: DecideRule[] = [];
  let failed = false;
  let waiting = false;

  for (const branchId of node.requiredBranches) {
    const facts = input.branches.get(branchId);
    const state = facts?.state ?? null;
    let gapReason = facts?.gapReason ?? null;
    if (state !== 'succeeded') {
      const result = decide(plan, { kind: 'upstream-terminal', nodeId: joinId, upstreamId: branchId, seq: input.seq });
      rules.push(result.rule);
      if (result.rule === 'B2') failed = true;
      else waiting = true;
      if (gapReason === null) gapReason = result.rule === 'B2' ? 'upstream-abandoned' : 'upstream-terminal';
    }
    report.push({
      nodeId: branchId,
      binding: facts?.binding ?? null,
      state,
      artifactRefs: facts?.artifactRefs ?? [],
      decisionRef: facts?.decisionRef ?? null,
      gapReason: state === 'succeeded' ? null : gapReason,
    });
  }

  const status = failed ? 'failed' : waiting ? 'waiting' : 'verifying';
  return { status, requiredBranches: node.requiredBranches, branchReport: report, rules, violation: null };
}
