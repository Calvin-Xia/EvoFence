import type { BudgetLedger } from '../../kernel/policy/index.js';
import type { AuthorizedEffect, BudgetPolicy, DelegationRequest, DelegationGrant, Effect, HostPort,
  HostResult, Receipt, Usage } from '../../runtime/host-port/index.js';
import type { PiExtensionAPI, PiManager } from './types.js';

export interface PiRequestOwner { readonly requestId: string; readonly invocationId: string }
/** Storage belongs to the parent; there is no child ledger constructor or credential store. */
export interface PiRequestState {
  readonly ledger: BudgetLedger;
  readonly owners: readonly PiRequestOwner[];
  readonly usage: readonly Usage[];
}
export interface PiRequestBounds {
  readonly inputTokens: number; readonly outputTokens: number; readonly usdMicros: number;
}
export interface PiSharedRequests {
  readonly poolId: string;
  beforeRequest(requestId: string, invocationId: string, policy: BudgetPolicy, bounds: PiRequestBounds): HostResult<void>;
  record(usage: Usage): HostResult<void>;
  report(invocationId: string): { readonly requestIds: readonly string[]; readonly usage: readonly Usage[] };
}
export interface PiDelegationPlan {
  readonly request: DelegationRequest;
  readonly capabilities: readonly string[];
  /** Kernel-provided, committed work for graphRef. The adapter does not claim or decide nodes. */
  readonly effects: readonly Effect[];
}
export interface PiInheritedModel {
  readonly provider: string; readonly modelId: string; readonly thinkingLevel: string;
}
export interface PiChildSpec {
  readonly parentSessionId: string; readonly kernelSessionId: string;
  readonly invocationId: string; readonly model: PiInheritedModel;
  readonly deadline: number;
  readonly graphRef: NonNullable<Effect['payload']['graphRef']>;
  readonly context: Effect['payload']['context'];
  readonly grant: DelegationGrant; readonly capabilities: readonly string[];
  readonly requests: Pick<PiSharedRequests, 'poolId' | 'beforeRequest' | 'record'>;
}
/** Explicit SDK factory seam. Every provider/implicit request must pass spec.requests first. */
export interface PiChildExecutor {
  readonly sessionId: string;
  readonly host: HostPort;
  dispose(): void;
}
export interface PiDelegationOptions {
  readonly version: string; readonly kernelSessionId: string; readonly parentSessionId: string;
  readonly manager: PiManager; readonly parent: HostPort;
  readonly parentCapabilities: readonly string[]; readonly model: PiInheritedModel;
  readonly clock: { now(): number }; readonly requests: PiSharedRequests;
  readonly plan: (authorized: AuthorizedEffect) => Promise<HostResult<PiDelegationPlan>>;
  readonly create: (spec: PiChildSpec) => Promise<HostResult<PiChildExecutor>>;
  /** Reopens exactly this recorded child; reads native receipts, never prompts/replays. */
  readonly restore: (spec: PiChildSpec, childSessionId: string) => Promise<HostResult<PiChildExecutor>>;
  readonly append: PiExtensionAPI['appendEntry'];
}
export interface PiDelegationBinding {
  readonly host: HostPort;
  close(reason: 'shutdown' | 'unload' | 'exception'): Promise<HostResult<void>>;
  receipt(effectId: string): Receipt | null;
}
export interface PiDelegationRecord {
  readonly version: 1; readonly parentSessionId: string; readonly kernelSessionId: string;
  readonly authorized: AuthorizedEffect; readonly plan: PiDelegationPlan;
  readonly childGrant: DelegationGrant; readonly childSessionId: string | null;
  readonly phase: 'prepared' | 'created' | 'dispatched' | 'receipt';
  readonly receipt: Receipt | null;
}
