/**
 * `evofence.kernel.graph` — the graph compiler and atomic revision engine (node `l2_graph_model`).
 *
 * The public entry point. Consumers import from here, not from the individual modules, so the file
 * layout can change without breaking the contract. Everything exported is pure: no I/O, no clock, no
 * ambient state (OWNERSHIP `I01–I08`); the outside facts a decision needs — authority, active nodes,
 * produced artifacts, resource holders — are parameters.
 *
 * Reading order for the semantics this module implements:
 *   `spec/graph/SEMANTICS.md` §2.2 (state machine), §2.4 (`terminal`/`abandonedBranches`),
 *   §3.0 (`decide`), §4 (bounded loops), §5 (revision + the eleven checks);
 *   `spec/graph/EXAMPLES.md` (the ten accept/fail worked examples, encoded in `test/l2-graph-*`).
 */
export {
  BLOCKING_EDGES,
  DEPENDENCY_PROJECTION,
  MUTATION_LOCKED_STATES,
  ROUTING_EDGES,
  type AbandonedBranch,
  type ArtifactRef,
  type Binding,
  type BranchEvidence,
  type CompileResult,
  type CompiledGraph,
  type DecideEvent,
  type DecidePlan,
  type DecideResult,
  type DecideRule,
  type EdgeSpec,
  type EdgeType,
  type Gap,
  type GraphAction,
  type GraphAuthority,
  type GraphContext,
  type GraphDiff,
  type GraphIssue,
  type GraphPatch,
  type GraphSpec,
  type LoopSpec,
  type NodeKind,
  type NodeOutcome,
  type NodeSpec,
  type NodeState,
  type OutcomeEvent,
  type Predicate,
  type ResourcePolicy,
  type SchemaRef,
  type StopKind,
  type TaskOutcome,
  type UpstreamTerminalEvent,
} from './types.js';

export { buildGraph, compileGraph } from './compile.js';
export { applyGraphPatch, diffGraphs, type ActiveNode, type PatchContext, type PatchResult } from './patch.js';
export {
  decide,
  evaluateJoin,
  outcomeEnv,
  stateFromDecision,
  type BranchFacts,
  type JoinEvaluation,
  type JoinInput,
} from './decide.js';
export { evaluateReadiness, type HolderCount, type NodeFacts, type Readiness } from './readiness.js';
export {
  exhaustedBound,
  loopBoundKinds,
  loopStop,
  resumeLoop,
  settleIteration,
  type IterationDelta,
  type LoopBody,
  type LoopBoundKind,
  type LoopProgress,
  type LoopStop,
} from './loop.js';
export { evalPredicate, readPath, validatePredicate, type PredicateEnv } from './predicate.js';
export {
  blockingOutgoing,
  hasBlockingConsumer,
  hasDeclaredCover,
  hasRealConsumer,
  hasRoutingOutgoing,
  matchingOutgoing,
  routingOutgoing,
  whenMatches,
} from './edges.js';
export { consumable, dataEdgeIssues, sameSchema } from './artifacts.js';
export { checkDataConsumable, firstIssue, validateGraph } from './validate.js';
export { checkFanIn, checkReferences, checkResources, joinNodeIds } from './structural.js';
export { checkDependencyAcyclic, checkTermination } from './cycle.js';
export { checkBounds, checkTerminalRequired } from './bounds.js';
export { checkAbandonment, checkAuthority } from './abandonment.js';
