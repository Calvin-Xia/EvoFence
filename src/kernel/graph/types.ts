/**
 * The graph model's internal contract.
 *
 * Scope: compile a frozen `GraphSpec` into an indexed plan, validate the eleven atomic rules of
 * `SEMANTICS.md §5.1`, decide node transitions through one `decide(event)` entry point, and commit
 * `GraphPatch` revisions atomically. Nothing here spawns work, touches storage or reads a clock;
 * `decide` and every validator are pure functions over the values they are handed (`I07`).
 *
 * Types come from the protocol layer's `Decoded<K>`, never from a second hand-written field list.
 * `Decoded<K>` is exact for a top-level object but its nested `$ref` objects are typed as
 * `Record<string, unknown>`; `Refined` narrows only those container slots back to the matching
 * `Decoded` object type. Field names are never restated, so a schema rename is a compile error here.
 */
import type { Decoded, ErrorCode, ErrorEnvelope } from '../../protocol/index.js';

type Refined<Base, Override> = Omit<Base, keyof Override> & Override;

export type ProtocolVersion = Decoded<'ProtocolVersion'>;
export type ContractRef = Decoded<'ContractRef'>;
export type GraphRef = Decoded<'GraphRef'>;
export type SchemaRef = Decoded<'SchemaRef'>;
export type ActorRef = Decoded<'ActorRef'>;
export type Binding = Decoded<'Binding'>;
export type ResourcePolicy = Decoded<'ResourcePolicy'>;
export type GraphLimits = Decoded<'GraphLimits'>;
export type AbandonedBranch = Decoded<'AbandonedBranch'>;
export type NodeState = Decoded<'NodeState'>;

export type ArtifactRef = Refined<
  Decoded<'ArtifactRef'>,
  { readonly producer: ActorRef; readonly binding: Binding | null; readonly schema: SchemaRef }
>;

/** A pure data predicate; only `children` needs refining (it is a nested `$ref` array). */
export type Predicate = Refined<Decoded<'Predicate'>, { readonly children: readonly Predicate[] }>;

export type LoopSpec = Refined<
  Decoded<'LoopSpec'>,
  { readonly carry: readonly ArtifactRef[]; readonly maxTokensOrCost?: Decoded<'BudgetBound'> }
>;

export type NodeSpec = Refined<
  Decoded<'NodeSpec'>,
  {
    readonly inputRefs: readonly ArtifactRef[];
    readonly outputSchemas: readonly SchemaRef[];
    readonly loop: LoopSpec | null;
    readonly subgraph: GraphRef | null;
    readonly contextPlan: Decoded<'ContextPlan'>;
    readonly toolRequirements: readonly Decoded<'GuaranteeRequirement'>[];
    readonly modelRequirements: Decoded<'ModelRequirement'>;
    readonly resources: Decoded<'Resources'>;
    readonly termination: Decoded<'TerminationPolicy'>;
  }
>;

export type EdgeSpec = Refined<
  Decoded<'EdgeSpec'>,
  { readonly when: Predicate | null; readonly artifact: ArtifactRef | null; readonly expect: SchemaRef | null }
>;

export type GraphSpec = Refined<
  Decoded<'GraphSpec'>,
  {
    readonly protocol: ProtocolVersion;
    readonly taskContractRef: ContractRef;
    readonly nodes: readonly NodeSpec[];
    readonly typedEdges: readonly EdgeSpec[];
    readonly requiredJoins: readonly string[];
    readonly resourcePolicy: readonly ResourcePolicy[];
    readonly graphLimits: GraphLimits;
    readonly abandonedBranches: readonly AbandonedBranch[];
  }
>;

export type GraphPatch = Refined<
  Decoded<'GraphPatch'>,
  {
    readonly protocol: ProtocolVersion;
    readonly adds: readonly NodeSpec[];
    readonly changes: readonly NodeSpec[];
    readonly typedEdges: readonly EdgeSpec[];
    readonly abandonedBranches: readonly AbandonedBranch[];
  }
>;

export type BranchEvidence = Refined<
  Decoded<'BranchEvidence'>,
  { readonly binding: Binding | null; readonly artifactRefs: readonly ArtifactRef[]; readonly decisionRef: ArtifactRef | null }
>;

export type EdgeType = EdgeSpec['type'];
export type NodeKind = NodeSpec['kind'];
export type StopKind = LoopSpec['stop'][number];

/** The `DecisionRecord` task outcomes that can resolve `verifying` (`SCHEMAS.md §6`). */
export type TaskOutcome = 'completed' | 'repair' | 'failed' | 'needs-human' | 'unknown';

/** Control edges: they route an outcome and can form a (bounded) control cycle. */
export const ROUTING_EDGES: readonly EdgeType[] = ['route', 'repair', 'fallback'];
/** Blocking edges: their `to` waits on `from`'s success or artifact. */
export const BLOCKING_EDGES: readonly EdgeType[] = ['dependency', 'data'];
/** The dependency projection whose acyclicity check 3 asserts (`dependency ∪ data`). */
export const DEPENDENCY_PROJECTION: readonly EdgeType[] = ['dependency', 'data'];

/**
 * Nodes that cannot be changed in place by a patch (`SEMANTICS.md §5.2`, `INTERFACES.md §4`).
 * `pending`/`ready` are freely editable; `failed`/`succeeded`/`cancelled` are protected by the
 * evidence rule (check 11) instead of by state.
 */
export const MUTATION_LOCKED_STATES: readonly NodeState[] = [
  'leased',
  'running',
  'verifying',
  'unknown',
  'cancelling',
];

/** A known, enumerable missing input. `unknown` is deliberately not a `Gap` (`SEMANTICS.md §2.2`). */
export interface Gap {
  readonly kind: 'upstream-terminal' | 'input-artifact-stale' | 'join-incomplete' | 'resource-unavailable';
  /** The upstream node or resource the gap is about. */
  readonly node: string;
  /** Journal sequence at which the gap was observed (`decide` event B carries it). */
  readonly at: number;
}

/** The two graph-layer actions `decide` may return (`SEMANTICS.md §3.0.2`). */
export type GraphAction =
  | { readonly kind: 'enable'; readonly nodeId: string }
  | { readonly kind: 'new-attempt'; readonly nodeId: string; readonly previousReason: string };

/** Event A: node `nodeId` produced an outcome (host receipt + TaskDecision). */
export interface OutcomeEvent {
  readonly kind: 'outcome';
  readonly nodeId: string;
  /** The state the node is in while deciding; only `INV` reads it (it must leave the node put). */
  readonly state: NodeState;
  readonly outcome: NodeOutcome;
}

/** Event B: blocking upstream `upstreamId` reached a non-`succeeded` terminal state. */
export interface UpstreamTerminalEvent {
  readonly kind: 'upstream-terminal';
  readonly nodeId: string;
  readonly upstreamId: string;
  readonly seq: number;
}

export type DecideEvent = OutcomeEvent | UpstreamTerminalEvent;

/**
 * What a node produced. `ok` mirrors the host outcome; `decision` is the `TaskDecision` outcome
 * that `verifying` resolves against. A failure keeps its real `reason`, which becomes the predicate
 * input `self.reason` and the recorded failure reason — never a synthesised "clean" one.
 */
export interface NodeOutcome {
  readonly ok: boolean;
  readonly reason: string;
  readonly decision: TaskOutcome;
}

export type DecideRule = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'B1' | 'B2' | 'B3' | 'INV';

/**
 * `decide`'s result. `nodeState` is the state `N` moves to; `graphActions` is what the graph can
 * advance next. The two are separate on purpose: A3/A4 leave the node `failed` while still
 * enabling a target (`SEMANTICS.md §3.0.2`).
 */
export interface DecideResult {
  readonly rule: DecideRule;
  readonly nodeState: NodeState;
  readonly graphActions: readonly GraphAction[];
  /** Set when `nodeState` is `failed` — the real reason, preserved. */
  readonly reason: string | null;
  /** Set for B1/B3 — the enumerable gap the node waits on. */
  readonly gap: Gap | null;
  /** Set only by `INV`: a bypass alarm; the caller reconciles and does not write `failed`. */
  readonly violation: ErrorEnvelope | null;
}

/**
 * The minimum `decide` reads. `CompiledGraph` satisfies it; a caller that bypassed validation can
 * pass any lookup, which is how the `INV` alarm is reachable without faking a compile.
 */
export interface DecidePlan {
  readonly node: (nodeId: string) => NodeSpec | undefined;
  readonly edgesFrom: (nodeId: string) => readonly EdgeSpec[];
  readonly edgesTo: (nodeId: string) => readonly EdgeSpec[];
  readonly isAbandoned: (nodeId: string) => boolean;
}

/** One rejected atomic rule. `check` is the `SEMANTICS.md §5.1` item number (1..11). */
export interface GraphIssue {
  readonly check: number;
  readonly code: ErrorCode;
  readonly message: string;
}

/** The outside facts a graph cannot express about itself. */
export interface GraphContext {
  /** Branch ids the bound `TaskContract.requiredBranches` demands; they must exist as nodes. */
  readonly contractBranches?: readonly string[];
}

/** The authority ceiling a patch runs under (the policy lane's grant, projected to node ids). */
export interface GraphAuthority {
  /** `authorityRef` values this graph may be mutated with. */
  readonly grantRefs: readonly string[];
  /** Permitted node ids; `null` means the grant covers the whole contract. */
  readonly nodeIds: readonly string[] | null;
  /** Permitted tool capability keys; `null` means "do not check capabilities here". */
  readonly capabilities: readonly string[] | null;
}

/** A compiled, indexed, validated graph. Built once; every reader below is pure. */
export interface CompiledGraph extends DecidePlan {
  readonly graphId: string;
  readonly revision: number;
  readonly spec: GraphSpec;
  readonly nodes: ReadonlyMap<string, NodeSpec>;
  readonly edges: readonly EdgeSpec[];
  readonly joinIds: readonly string[];
  readonly abandoned: ReadonlyMap<string, AbandonedBranch>;
  readonly resourcePolicy: ReadonlyMap<string, ResourcePolicy>;
}

export type CompileResult =
  | { readonly ok: true; readonly graph: CompiledGraph }
  | { readonly ok: false; readonly error: ErrorEnvelope };

/** A structural diff between two revisions; ids only, so it is deterministic and cheap to compare. */
export interface GraphDiff {
  readonly addedNodes: readonly string[];
  readonly removedNodes: readonly string[];
  readonly changedNodes: readonly string[];
  readonly addedEdges: readonly string[];
  readonly removedEdges: readonly string[];
  readonly changedEdges: readonly string[];
}
