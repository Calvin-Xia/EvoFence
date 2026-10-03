/**
 * Fan-in: a `join` node's branch report, complete and unfiltered.
 *
 * The judgement itself is `evaluateJoin` from the graph lane — one implementation of B1/B2/B3, used
 * by readiness and by this report alike. What this module adds is the scheduler's view of it: the
 * list of required branches that have *not* succeeded, in `requiredBranches` order.
 *
 * `SEMANTICS.md §5.3` and `SCHEMAS.md` S20 are explicit that this list may never be filtered: a
 * branch that failed, was cancelled or never reported stays in the report, because "looks all
 * green" is exactly the failure mode the rule exists to prevent. A join is never `ready` unless
 * every required branch succeeded — that part comes from readiness, not from here.
 */
import { evaluateJoin } from '../graph/index.js';
import { fail } from '../../protocol/index.js';
import type { BranchEvidence, CompiledGraph, NodeFacts } from '../graph/index.js';

export interface JoinGate {
  readonly joinId: string;
  readonly status: 'verifying' | 'waiting' | 'failed';
  readonly requiredBranches: readonly string[];
  readonly branchReport: readonly BranchEvidence[];
  /** Every required branch that has not succeeded, in declaration order — never filtered. */
  readonly missing: readonly string[];
}

export function joinGate(graph: CompiledGraph, facts: NodeFacts, joinId: string): JoinGate {
  if (facts.branches === undefined) {
    throw fail('EFK_INVARIANT_VIOLATION', `join ${joinId} requires explicit branch facts`, [joinId]);
  }
  const evaluation = evaluateJoin(graph, joinId, {
    seq: facts.seq,
    branches: facts.branches,
  });
  return {
    joinId,
    status: evaluation.status,
    requiredBranches: evaluation.requiredBranches,
    branchReport: evaluation.branchReport,
    missing: evaluation.branchReport.filter((branch) => branch.state !== 'succeeded').map((branch) => branch.nodeId),
  };
}
