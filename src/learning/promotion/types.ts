import type { ErrorEnvelope } from '../../protocol/index.js';
import type { ActorRef, ArtifactRef } from '../../kernel/artifacts/index.js';
import type { AuthorityRequest } from '../../kernel/policy/index.js';
import type { EventStore, StoreResult } from '../../kernel/store/index.js';
import type { Clock, DelegationGrant, Effect, HostPort, Receipt } from '../../runtime/host-port/index.js';
import type { ActivationReceipt, AssetRef, QualificationContext, RegistryPorts, RegistrySnapshot, Scope } from '../assets/index.js';

/** Local journal projection; none of these types extend a frozen wire schema. */
export interface AssetPointer {
  readonly pointerId: string;
  readonly version: number;
  readonly hostSessionId: string;
  readonly scope: Scope;
  readonly promoted: AssetRef | null;
  readonly active: AssetRef | null;
  readonly snapshot: ArtifactRef;
}
export interface PromotionRule {
  readonly ruleId: string;
  readonly authorizationRef: string;
  readonly hostSessionId: string;
  readonly assets: readonly AssetRef[];
  readonly allowTemporary: boolean;
  readonly authority: Omit<AuthorityRequest, 'now'>;
}
/** Trusted permission-root inputs, refreshed at each action; requests cannot supply rules/grants. */
export interface PromotionPolicy {
  rule(ruleId: string): StoreResult<PromotionRule | null>;
  grant(grantId: string): StoreResult<DelegationGrant | null>;
  verifyLease(effect: Effect, at: number): StoreResult<true>;
}
export interface PromoteInput {
  readonly requestId: string;
  readonly expected: AssetPointer;
  readonly asset: AssetRef;
  readonly evaluationRefs: readonly ArtifactRef[];
  readonly ruleId: string;
  readonly temporary: boolean;
  readonly context: QualificationContext;
}
export interface ActivateInput {
  readonly promotionId: string;
  readonly effect: Effect;
}
export interface RollbackInput {
  readonly requestId: string;
  readonly expected: AssetPointer;
  readonly targetPromotionId: string;
  readonly ruleId: string;
  readonly context: QualificationContext;
}
export interface PromotionRecord {
  readonly promotionId: string;
  readonly requestDigest: string;
  readonly mode: 'promotion' | 'rollback';
  readonly previous: AssetPointer;
  readonly asset: AssetRef;
  readonly evaluationRef: ArtifactRef;
  readonly ruleId: string;
  readonly authorizationRef: string;
  readonly context: QualificationContext;
  readonly decisionRef: ArtifactRef;
  readonly targetSnapshot: ArtifactRef | null;
  readonly status: 'promoted' | 'pending' | 'active' | 'failed' | 'applied-unqualified';
  readonly effect: Effect | null;
  readonly hostReceipt: Receipt | null;
  readonly activation: ActivationReceipt | null;
  readonly activationRef: ArtifactRef | null;
  readonly activationDecisionRef: ArtifactRef | null;
  readonly error: ErrorEnvelope | null;
}
export interface PromotionState {
  readonly registry: RegistrySnapshot;
  readonly pointers: readonly AssetPointer[];
  readonly promotions: readonly PromotionRecord[];
}
export interface PromotionPorts {
  readonly sessionId: string;
  readonly journal: EventStore;
  readonly registry: RegistryPorts;
  readonly host: HostPort;
  readonly clock: Clock;
  readonly policy: PromotionPolicy;
  /** Registered host-adapter principal; receipt attribution is exact, not just a kind check. */
  readonly hostIssuer: ActorRef;
}
export interface ActivatedVersion {
  readonly pointerId: string;
  readonly pointerVersion: number;
  readonly asset: AssetRef;
  readonly snapshot: ArtifactRef;
}
