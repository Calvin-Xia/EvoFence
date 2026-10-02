import type { ErrorEnvelope } from '../../protocol/index.js';
import type { ActorRef, ArtifactRef } from '../../kernel/artifacts/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import type { CancelOutcome, Effect } from '../../runtime/host-port/index.js';
import type { AssetRef, QualificationContext } from '../../learning/assets/index.js';
import type { ActivatedVersion, PromotionPorts, PromotionRecord } from '../../learning/promotion/index.js';

/** Local monitoring metadata, not a new frozen protocol DTO or capability verdict. */
export interface QualityPolicy {
  readonly minimums: Readonly<Record<string, number>>;
  readonly maxAgeMs: number;
  readonly requireQuality: boolean;
}
export interface QualitySignal {
  readonly asset: AssetRef;
  readonly context: QualificationContext;
  readonly source: 'dev' | 'online';
  readonly metric: string;
  readonly value: number;
  readonly measuredAt: number;
}
export interface MonitorInput {
  readonly requestId: string;
  readonly asset: AssetRef;
  readonly context: QualificationContext;
  readonly ruleId: string;
  readonly signalRefs: readonly ArtifactRef[];
}
export interface Cancellation {
  readonly promotionId: string;
  readonly effectId: string | null;
  readonly hostSessionId: string;
  readonly status: 'not-executed' | 'needed' | 'requested' | 'observed' | 'settled';
  readonly outcomeRef: ArtifactRef | null;
  readonly reconciliationRef: ArtifactRef | null;
}
export interface RestorePlan {
  readonly pointerId: string;
  readonly targetPromotionId: string | null;
  readonly targetSnapshot: ArtifactRef | null;
  readonly rollbackId: string;
}
export interface RevocationRecord {
  readonly requestId: string;
  readonly requestDigest: string;
  readonly at: number;
  readonly root: AssetRef;
  readonly context: QualificationContext;
  readonly ruleId: string;
  readonly reasons: readonly string[];
  readonly affected: readonly AssetRef[];
  readonly evidenceRef: ArtifactRef;
  readonly cancellations: readonly Cancellation[];
  readonly restores: readonly RestorePlan[];
  readonly status: 'pending' | 'complete';
  readonly error: ErrorEnvelope | null;
}
export interface RevocationPorts {
  readonly promotion: PromotionPorts;
  readonly monitorIssuer: ActorRef;
  /** Complete trusted inventory for this asset/context; callers cannot cherry-pick measurements. */
  signalInventory(asset: AssetRef, context: QualificationContext): StoreResult<readonly ArtifactRef[]>;
  /** Trusted origin verification must bind metadata as well as bytes, including split labels. */
  verifySignal(ref: ArtifactRef): StoreResult<true>;
  policy(asset: AssetRef): StoreResult<QualityPolicy>;
  /** The owning runtime supplies the effect with its current grant, epoch and lease. */
  restoreEffect(record: PromotionRecord): StoreResult<Effect>;
}
export interface OrdinaryTaskView {
  readonly versions: readonly ActivatedVersion[];
  readonly evolutionError: ErrorEnvelope | null;
}
export type { CancelOutcome };
