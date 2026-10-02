import type { ErrorEnvelope } from '../../protocol/index.js';
import type { AuthorizedEffect, ContextPlan, HostPort, HostResult, Receipt, Usage } from '../../runtime/host-port/index.js';

/** Structural slice of the pinned SDK: no discovery, credential loading or SDK singleton. */
export interface PiManager {
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getEntries(): readonly { type: string; customType?: string; data?: unknown }[];
}
export interface PiSession {
  readonly sessionManager: PiManager;
  readonly isIdle: boolean;
  prompt(text: string): Promise<void>;
  waitForIdle(): Promise<void>;
  abort(): Promise<void>;
}
export interface PiContext { readonly sessionManager: PiManager; isIdle(): boolean }
export interface PiMessage {
  readonly role: string;
  readonly stopReason?: string;
  readonly usage?: unknown;
}
export interface PiToolCall {
  readonly type: 'tool_call'; readonly toolCallId: string; readonly toolName: string;
  /** 0.99.2 nested tool calls retain their native parent identity. */
  readonly parentToolCallId?: string;
  readonly input: Readonly<Record<string, unknown>>;
}
export interface PiToolResult {
  readonly type: 'tool_result'; readonly toolCallId: string; readonly toolName: string;
  readonly parentToolCallId?: string;
  readonly input: Readonly<Record<string, unknown>>; readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError: boolean; readonly usage?: unknown; readonly details?: unknown;
}
export interface PiEvents {
  session_start: { readonly type: 'session_start'; readonly reason: string };
  session_shutdown: { readonly type: 'session_shutdown'; readonly reason: string };
  agent_start: { readonly type: 'agent_start' };
  agent_end: { readonly type: 'agent_end'; readonly messages: readonly PiMessage[] };
  agent_settled: { readonly type: 'agent_settled' };
  context: { readonly type: 'context'; readonly messages: readonly unknown[] };
  before_provider_request: { readonly type: 'before_provider_request'; readonly payload: unknown };
  message_end: { readonly type: 'message_end'; readonly message: PiMessage };
  tool_call: PiToolCall;
  tool_result: PiToolResult;
}
export interface PiEventResults {
  session_start: void; session_shutdown: void; agent_start: void; agent_end: void;
  agent_settled: void; before_provider_request: void; message_end: void; tool_result: void;
  context: { messages: unknown[] } | void;
  tool_call: { block: true; reason: string } | void;
}
export interface PiExtensionAPI {
  on<K extends keyof PiEvents>(name: K, handler: (event: PiEvents[K], context: PiContext) =>
    PiEventResults[K] | Promise<PiEventResults[K]>): () => void;
  appendEntry(customType: string, data: unknown): void;
}
export interface PiUsageEvidence {
  readonly raw: unknown;
  readonly source: Usage['source'];
  readonly evidenceRefs: Usage['evidenceRefs'];
}
export interface PiOptions {
  readonly version: string;
  readonly kernelSessionId: string;
  readonly hostSessionId: string;
  /** Host owns this already-created persistent session. Binding never creates or disposes it. */
  readonly session: () => PiSession;
  readonly clock: { now(): number };
  readonly prompt: (authorized: AuthorizedEffect) => Promise<string>;
  /** Resolves authorized refs and enforces maxTokens; no whole-prompt replacement. */
  readonly context: (plan: ContextPlan) => Promise<HostResult<readonly unknown[]>>;
  readonly toolGate: (authorized: AuthorizedEffect, event: PiToolCall) => Promise<HostResult<void>>;
  readonly toolResult: (authorized: AuthorizedEffect, event: PiToolResult) => Promise<void>;
  /** Raw provider usage, when captured by the host transport; otherwise SDK-normalized. */
  readonly usageEvidence?: (requestId: string, message: PiMessage) => PiUsageEvidence;
  /** Must not execute another loop or wait for idle from inside this awaited hook. */
  readonly agentEnd?: (authorized: AuthorizedEffect) => Promise<void>;
  readonly fault: (error: ErrorEnvelope) => void;
}
export interface PiBinding {
  readonly host: HostPort;
  unload(): void;
  state(): { attached: boolean; idle: boolean; fault: ErrorEnvelope | null; activeEffectId: string | null };
  receipt(effectId: string): Receipt | null;
}
