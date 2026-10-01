import type { ErrorCode } from '../../protocol/index.js';
import type { ArtifactStore } from '../../kernel/artifacts/index.js';
import type { AssetRef, Qualification, QualificationContext, RegistrySnapshot } from '../assets/index.js';
import type { BoundedContextPacket, ContextArtifact, ContextInputs, ContextPorts, ContextRole, WindowBudget } from '../context/index.js';

export type AssetIdentity = Pick<AssetRef, 'assetId' | 'revision' | 'digest'>;
export interface RetrievalBudget {
  /** The controlled C arm permits at most five assets; zero explicitly disables injection. */
  readonly maxAssets: number;
  /** Nonnegative complete-packet token delta relative to the same base execution. */
  readonly maxAddedTokens: number;
}
/** Local candidate-building parameters, not a new protocol DTO or activation receipt. */
export interface RetrievalInput {
  readonly registry: RegistrySnapshot;
  readonly candidates: readonly AssetRef[];
  readonly context: QualificationContext;
  readonly taskContract: unknown;
  readonly role: ContextRole;
  /** Base plan excludes asset content. nodeInputRefs declares all permitted candidate inputs. */
  readonly baseInputs: ContextInputs;
  readonly materials: readonly ContextArtifact[];
  readonly window: WindowBudget;
  readonly budget: RetrievalBudget;
}
export interface RetrievalPorts extends ContextPorts {
  readonly artifacts: ArtifactStore;
}
export type IgnoreReason = ErrorCode | 'asset-count-budget' | 'added-token-budget' | 'context-window-budget';
export interface RetrievalAttribution {
  readonly asset: AssetIdentity;
  readonly qualification: Qualification | null;
  /** Qualified and material-admitted into the ranked pool, even if later clipped. */
  readonly retrieved: boolean;
  readonly disposition: 'pending' | 'used' | 'ignored';
  readonly reasons: readonly IgnoreReason[];
  readonly contentTokens: number | null;
  readonly entryIds: readonly string[];
  readonly feedbackReason: string | null;
}
export interface RetrievalCost {
  readonly basis: 'injected-tokenizer-estimate';
  readonly tokenizerId: string;
  readonly baselineInputTokens: number;
  readonly candidateInputTokens: number;
  /** Signed delta retained for tokenizers whose counts are not monotonic. */
  readonly inputTokenDelta: number;
  readonly chargedAddedTokens: number;
  readonly qualificationQueries: number;
  readonly materialReads: number;
  readonly materialCodeUnits: number;
  readonly tokenizerCalls: number;
  /** Computational work, not billed model input: includes discarded trial packets. */
  readonly tokensCounted: number;
  readonly modelRequests: 0;
  /** Caller must measure CPU/wall and price actual dispatch usage in the experiment envelope. */
  readonly wallMs: null;
  readonly usdMicros: null;
}
export interface ActivationContextCandidate {
  readonly assets: readonly AssetIdentity[];
  readonly context: BoundedContextPacket;
}
export interface RetrievalResult {
  readonly mode: 'candidate' | 'base';
  readonly fallbackReason: 'no-eligible-assets' | 'no-assets-fit' | null;
  readonly candidate: ActivationContextCandidate | null;
  readonly context: BoundedContextPacket;
  readonly attribution: readonly RetrievalAttribution[];
  readonly cost: RetrievalCost;
}
/** Reported by the caller's execution/evidence path; this module cannot infer actual adoption. */
export interface UsageFeedback {
  readonly asset: AssetIdentity;
  readonly disposition: 'used' | 'ignored';
  readonly reason: string;
}
