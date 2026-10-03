/** Structural seams of the pinned 0.2.0-rc.2 SDK, supplied by the Cordis composition. */
import type { ErrorEnvelope } from '../../protocol/index.js';
import type { ArtifactRef, BoardOwner, Effect, HostPort, HostResult, Receipt, Usage } from '../../runtime/host-port/index.js';
import type { CreateSessionRequest, RuntimeState, SessionPorts, SessionService } from '../../runtime/session/index.js';

export interface NativeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}
export interface NativeEvent {
  readonly seq: number;
  readonly type: string;
  readonly data: {
    readonly turn?: number;
    readonly step?: number;
    readonly callId?: string;
    readonly usage?: NativeUsage;
    readonly reason?: { readonly kind: string };
    readonly task?: NativeTask;
  };
}
export interface NativeTask {
  readonly id: string;
  readonly status: string;
  readonly ownerId?: string;
}
export interface NativeSession {
  readonly id: string;
  snapshotEvents(): readonly NativeEvent[];
}
export interface NativeAgent {
  readonly id: string;
  readonly session: NativeSession;
  readonly status: 'idle' | 'running';
  readonly options: { readonly maxTokens?: number; readonly provider?: string; readonly model?: string };
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
  cancel(cause: { kind: 'user' }, options: { keepInbox: true }): void;
}
export interface NativeExecution {
  readonly callId: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly agent?: NativeAgent;
  readonly signal: AbortSignal;
}
export interface NativeToolResult { readonly isError: boolean }
export type PreTool = { kind: 'deny'; reason: string } | { kind: 'allow' } | { kind: 'cancel' } | { kind: 'ask'; reason: string };
export type PreStep = { kind: 'reject' } | { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true };
export interface NativeEvents {
  'agent/created': (payload: { agent: NativeAgent; source: string }) => Promise<void>;
  'agent/disposed': (payload: { agent: NativeAgent }) => void;
  'agent/status': (payload: { agent: NativeAgent; status: string }) => void;
  'agent/pre-step': (payload: { agent: NativeAgent; messages: unknown[]; turn: number; step: number }, next: () => Promise<PreStep>) => Promise<PreStep>;
  'tools/pre-execute': (exec: NativeExecution, next: () => Promise<PreTool>) => Promise<PreTool>;
  'tools/result': (exec: NativeExecution, result: NativeToolResult) => void;
  'session/event': (session: NativeSession, event: NativeEvent) => void;
  'dispose': () => void;
}
export interface NativeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly output: { schema: unknown; render(args: unknown, value: unknown): unknown[] };
  execute(args: unknown, exec: NativeExecution): Promise<unknown>;
}
export interface ProjectionState { readonly hostSessionId: string; readonly lastSeq: number; readonly requests: number }
export interface NativeContext {
  on<K extends keyof NativeEvents>(event: K, callback: NativeEvents[K]): () => void;
  effect(execute: () => () => void, label: string): () => unknown;
  readonly agents: { get(id: string): NativeAgent | undefined; list(): NativeAgent[] };
  readonly tools: { register(definition: unknown): () => void; execute(exec: NativeExecution): Promise<NativeToolResult> };
  readonly sessionProjections: {
    register(definition: {
      key: string; stateVersion: number; stateSchema: unknown;
      init(header: { id: string }): ProjectionState;
      apply(state: ProjectionState, event: NativeEvent): ProjectionState;
      wire: { viewSchema: unknown; view(state: ProjectionState): ProjectionState };
    }): () => void;
  };
}
export interface NativeHelpers {
  message(text: string): unknown;
  defineTool(definition: NativeToolDefinition): unknown;
  readonly projectionSchema: unknown;
}
export interface DshObservation {
  readonly type: string;
  readonly hostSessionId: string;
  readonly seq: number | null;
  readonly callId: string | null;
  readonly isError: boolean | null;
}
export interface DshComposition {
  readonly version: string;
  readonly helpers: NativeHelpers;
  readonly ports: Omit<SessionPorts, 'host'>;
  /** The same exact seed must be supplied on resume. No automatic backend/credentials discovery. */
  sessionFor(agent: NativeAgent): CreateSessionRequest | null;
  readonly usageSource: 'synthetic' | 'host-normalized';
  /** A real host permission input, in addition to the host's existing waterfall policies. */
  allowTool(effect: Effect, exec: NativeExecution): Promise<HostResult<void>>;
  onObservation(observation: DshObservation): void;
}
export interface BoardLink extends BoardOwner { readonly taskId: string; readonly ownerSessionId: string }
export interface RunningEffect {
  readonly effect: Effect;
  readonly fromSeq: number;
  preSteps: number;
  readonly toolGates: Set<string>;
  readonly toolResults: Set<string>;
  readonly eventSeqs: Set<number>;
}
export interface DshSession {
  readonly agent: NativeAgent;
  readonly runtime: SessionService;
  readonly host: HostPort;
  readonly request: CreateSessionRequest;
  readonly observations: DshObservation[];
  readonly boardLinks: Map<string, BoardLink>;
  readonly receipts: Map<string, Receipt>;
  readonly usages: Map<string, readonly Usage[]>;
  readonly dispatched: Map<string, string>;
  fault: ErrorEnvelope | null;
  pauseError: ErrorEnvelope | null;
  disposed: boolean;
  running: RunningEffect | null;
  contextText: string[];
  busy: boolean;
}
export interface DshStatus {
  readonly hostSessionId: string;
  readonly sessionId: string;
  readonly health: 'active' | 'degraded' | 'disposed';
  readonly error: ErrorEnvelope | null;
  readonly pauseError: ErrorEnvelope | null;
  readonly revision: number;
  readonly epoch: number;
  readonly dispatchMode: RuntimeState['dispatchMode'];
  readonly nodeStates: RuntimeState['nodeStates'];
  readonly unknownEffectIds: readonly string[];
  readonly usageIssues: readonly string[];
}
export interface DshBinding {
  attach(agent: NativeAgent, source: string): HostResult<DshStatus>;
  session(id: string): HostResult<DshSession>;
  status(id: string): HostResult<DshStatus>;
  step(id: string): Promise<HostResult<unknown>>;
  pause(id: string, reason: string): HostResult<unknown>;
  resume(id: string, manifestRef: ArtifactRef): HostResult<unknown>;
  evaluate(id: string, effectId: string): Promise<HostResult<unknown>>;
  observe(id: string): Promise<HostResult<unknown>>;
  reconcile(id: string): Promise<HostResult<unknown>>;
  continue(id: string): HostResult<void>;
  settle(id: string): Promise<HostResult<unknown>>;
  projectBoard(id: string, link: BoardLink): HostResult<void>;
  dispose(): void;
}
