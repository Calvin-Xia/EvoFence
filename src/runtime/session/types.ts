/** Session application ports; no backend, permission root or evaluator is discovered. */
import type { Decoded, ErrorEnvelope, Instant } from '../../protocol/index.js';
import type { CompiledGraph, NodeSpec } from '../../kernel/graph/index.js';
import type { BudgetLedger, BudgetPolicy, RiskInput } from '../../kernel/policy/index.js';
import type { SchedulerState } from '../../kernel/scheduler/index.js';
import type {
  ArtifactRef, ArtifactStore, DigestPort, DispatchMode, Effect, Event, EventDraft,
  EventStore, ExportedSession, NodeStateEntry, OutboxProjection, Receipt, ReceiptOutcome,
  SessionHandle, StoreResult,
} from '../../kernel/store/index.js';
import type { Clock, DelegationGrant, HostObservation, HostPort } from '../host-port/index.js';

export type { ArtifactRef, Binding, Effect, Event, EventDraft, Receipt, StoreResult };
type Binding = Decoded<'Binding'>;
type GraphRef = Decoded<'GraphRef'>;
/** Explicit node operations: a node name never implicitly becomes a tool invocation. */
export type NodeOperation = Pick<Effect, 'kind' | 'payload' | 'inputRefs'>;
export interface SessionSeed {
  readonly sessionId: string;
  readonly graph: CompiledGraph;
  readonly graphRef: GraphRef;
  readonly policy: BudgetPolicy;
  readonly reservePerRequest: number;
  readonly grants: readonly DelegationGrant[];
  readonly operations: Readonly<Record<string, NodeOperation>>;
}
export interface RuntimeState {
  readonly sessionId: string;
  readonly protocol: Decoded<'ProtocolVersion'>;
  readonly epoch: number;
  readonly revision: number;
  readonly lastSequence: number | null;
  readonly dispatchMode: DispatchMode;
  readonly cancellation: 'none' | 'requested' | 'confirmed' | 'unconfirmed';
  readonly attempts: Readonly<Record<string, number>>;
  readonly nodeStates: readonly NodeStateEntry[];
  readonly effects: Readonly<Record<string, Effect>>;
  readonly receipts: Readonly<Record<string, Receipt>>;
  readonly resourceModes: Readonly<Record<string, 'exclusive' | 'shared'>>;
  readonly events: readonly Event[];
  readonly outbox: OutboxProjection;
  readonly budget: BudgetLedger;
  readonly usageIssues: readonly ErrorEnvelope[];
  readonly appliedInvocations: readonly string[];
  readonly invocationEffects: Readonly<Record<string, string>>;
  readonly scheduler: SchedulerState;
  readonly intents: readonly Effect[];
  readonly unknownEffectIds: readonly string[];
  readonly staleEffectIds: readonly string[];
  readonly archivedReceiptIds: readonly string[];
}
export interface PlannedBatch {
  readonly events: readonly EventDraft[];
  readonly effects: readonly Effect[];
  readonly receipts: readonly Receipt[];
}
export interface SessionCommand { readonly commandId: string; readonly expectedRevision: number }
export interface PauseRequest extends SessionCommand { readonly reason: string }
export interface ResumeRequest extends SessionCommand { readonly epoch: number; readonly manifestRef: ArtifactRef }
export interface CancelRequest extends SessionCommand { readonly reason: string }
export interface RoundPlan {
  readonly now: Instant;
  readonly leaseTtlMs: number;
  readonly effectTtlMs: number;
  readonly maxConcurrentAgents: number;
  readonly depth: number;
  readonly maxDepth: number;
}
export type Admission = Omit<RiskInput, 'budget' | 'usage'>;
export interface PolicyPort {
  /** Pinned inputs; the only decision is kernel/policy.decide. */
  inspect(seed: SessionSeed, node: NodeSpec, binding: Binding, now: Instant): Admission;
  /** Re-admit exact manifest/schema/host session before committing a new epoch. */
  resume(seed: SessionSeed, state: RuntimeState, request: ResumeRequest): StoreResult<void>;
}
export interface EvaluatorPort {
  readonly issuer: Decoded<'ActorRef'>;
  evaluateTask(seed: SessionSeed, state: RuntimeState, receipt: Receipt): Promise<StoreResult<unknown>>;
}
export interface SessionPorts extends Omit<RoundPlan, 'now'> {
  readonly store: EventStore;
  readonly artifacts: ArtifactStore;
  readonly host: HostPort;
  readonly clock: Clock;
  readonly digest: DigestPort;
  readonly policy: PolicyPort;
  readonly evaluator: EvaluatorPort;
}
export interface CommandOutcome {
  readonly sessionId: string;
  readonly revision: number;
  readonly eventIds: readonly string[];
  readonly effectIds: readonly string[];
}
export interface StepReport {
  readonly sessionId: string;
  readonly revision: number;
  readonly dispatchAttempted: readonly string[];
  readonly appliedReceipts: readonly string[];
  readonly archivedReceipts: readonly string[];
  readonly unknownEffectIds: readonly string[];
}
export interface CancelReport extends StepReport { readonly status: 'cancelled' | 'unknown'; readonly error: ErrorEnvelope | null }
export interface ReconcileReport {
  readonly sessionId: string;
  readonly resolved: readonly string[];
  readonly notExecuted: readonly string[];
  readonly unknown: readonly string[];
}
export interface CreateSessionRequest extends SessionSeed { readonly epoch: number; readonly protocol: unknown }
export interface SessionService {
  create(request: CreateSessionRequest): StoreResult<SessionHandle>;
  open(seed: SessionSeed): StoreResult<RuntimeState>;
  read(sessionId: string): StoreResult<RuntimeState>;
  step(sessionId: string): Promise<StoreResult<StepReport>>;
  pause(sessionId: string, request: PauseRequest): StoreResult<CommandOutcome>;
  resume(sessionId: string, request: ResumeRequest): StoreResult<CommandOutcome>;
  cancel(sessionId: string, request: CancelRequest): Promise<StoreResult<CancelReport>>;
  receive(sessionId: string, receipt: unknown): StoreResult<ReceiptOutcome>;
  evaluate(sessionId: string, effectId: string): Promise<StoreResult<CommandOutcome>>;
  observe(sessionId: string): Promise<StoreResult<HostObservation>>;
  reconcile(sessionId: string): Promise<StoreResult<ReconcileReport>>;
  close(sessionId: string): StoreResult<ExportedSession>;
}
