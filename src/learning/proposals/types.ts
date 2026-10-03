import type { ArtifactExpectation, ArtifactRef, ArtifactStore } from '../../kernel/artifacts/index.js';
import type { DigestPort, StoreResult } from '../../kernel/store/index.js';
import type { NodeOperation, SessionService } from '../../runtime/session/types.js';
import type { Usage } from '../../runtime/host-port/index.js';
import type { AssetCategory } from '../assets/index.js';

export type EvidenceGrade = 'provider-live' | 'native-fixture' | 'unknown';
export interface ProposalScope {
  readonly projectId: string; readonly hostId: string; readonly modelId: string; readonly taskId: string;
}
/** Trusted selection from the visible training split, not caller-supplied final feedback. */
export interface TraceSelection {
  readonly ref: ArtifactRef; readonly expectation: ArtifactExpectation;
  readonly scope: ProposalScope; readonly whyVisible: string; readonly grade: EvidenceGrade;
}
export interface ProposalLimits {
  readonly maxTraces: number; readonly maxTraceBytes: number; readonly maxEvents: number;
  readonly maxPatterns: number; readonly maxCandidates: number; readonly maxCandidateBytes: number;
  readonly maxTextChars: number; readonly maxInputTokens: number; readonly maxOutputTokens: number;
  readonly maxGenerationRequests: number; readonly maxGenerationMicros: number;
}
export interface ProposalPorts { readonly artifacts: ArtifactStore; readonly digest: DigestPort }
export interface EventLink {
  readonly traceId: string; readonly traceDigest: string; readonly line: number; readonly eventDigest: string;
  readonly type: string; readonly outcome: 'success' | 'failure';
}
export type PatternFacet = 'visible-check' | 'session-recovery' | 'usage-completeness' | 'cancel-confirmation';
export interface TraceEvent { readonly link: EventLink; readonly facet: PatternFacet; readonly label: string }
export interface VisibleTrace extends TraceSelection { readonly events: readonly TraceEvent[]; readonly totalLines: number }
export interface ExperiencePattern {
  readonly patternId: string; readonly scope: ProposalScope; readonly facet: PatternFacet;
  readonly successes: readonly EventLink[]; readonly failures: readonly EventLink[];
}
export interface Experience {
  readonly traces: readonly VisibleTrace[]; readonly patterns: readonly ExperiencePattern[];
  readonly limits: ProposalLimits; readonly digest: string;
}
/** Local proposal metadata; deliberately not an extension of the frozen CapabilityAsset schema. */
export interface CandidateDraft {
  readonly patternId: string; readonly category: Exclude<AssetCategory, 'code-patch'>;
  readonly hypothesis: { readonly intervention: string; readonly expectedImprovement: string; readonly measurement: string };
  readonly conditions: readonly string[]; readonly support: readonly EventLink[];
  readonly counterexamples: readonly { readonly event: EventLink; readonly limitation: string }[];
  readonly content: string;
}
export type GenerationAccounting =
  | { readonly method: 'deterministic'; readonly requests: 0; readonly estimatedUsdMicros: 0; readonly usage: readonly [] }
  | { readonly method: 'host-effect'; readonly poolId: string; readonly effectId: string; readonly receiptId: string;
      readonly requests: number; readonly reservedMicros: number; readonly estimatedUsdMicros: number;
      readonly usage: readonly Usage[]; readonly grade: EvidenceGrade; readonly outputRef: ArtifactRef };
export interface CandidateSpec extends CandidateDraft {
  readonly candidateId: string; readonly revision: 1; readonly qualification: 'staged';
  readonly claim: 'conditional-hypothesis'; readonly scope: ProposalScope;
  readonly sourceTraces: readonly ArtifactRef[]; readonly experienceDigest: string;
  readonly limits: ProposalLimits; readonly generation: GenerationAccounting;
}
export interface GenerationPlan {
  readonly promptRef: ArtifactRef; readonly operation: NodeOperation; readonly experienceDigest: string;
}
export interface GenerationCollector extends ProposalPorts {
  readonly sessions: Pick<SessionService, 'read'>;
}
export type ProposalResult<T> = StoreResult<T>;
