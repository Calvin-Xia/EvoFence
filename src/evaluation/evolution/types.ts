/** In-process evaluation inputs; no extension of the frozen receipt/decision wire schema. */
import type { Decoded } from '../../protocol/index.js';
import type { ActorRef, ArtifactRef, ArtifactStore } from '../../kernel/artifacts/index.js';
import type { DigestPort, StoreResult } from '../../kernel/store/index.js';
import type { BudgetPolicy, Usage, EvaluationEnvelope } from '../../kernel/policy/index.js';
import type { AssetRevision, AssetRef, ModelBinding, CapabilityJudgement, EvaluationReceipt } from '../../learning/assets/index.js';
export type { AssetRevision, AssetRef, ModelBinding, CapabilityJudgement, EvaluationReceipt, ActorRef, ArtifactRef };
export type Arm = 'A' | 'B' | 'C';
export type Comparison = 'B-A' | 'C-B';
export type Stratum = 'S1' | 'S2' | 'S3';
export interface Sample {
  readonly instanceId: string; readonly repoId: string; readonly familyId: string;
  readonly stratum: Stratum; readonly baseDigest: string;
  readonly contractRef: ArtifactRef; readonly privateTestsRef: ArtifactRef;
  readonly requiredBranches: readonly string[];
  readonly leakRisk: 'low' | 'reviewed' | 'high' | 'unreviewed';
}
export interface DataSplit {
  readonly partition: 'train' | 'dev' | 'held-out' | 'final'; readonly samples: readonly Sample[];
}
export interface HostBinding {
  readonly hostId: string; readonly version: string; readonly manifestRef: ArtifactRef;
  readonly model: ModelBinding; readonly toolsetDigest: string; readonly authorityDigest: string;
  readonly cellStatus: CapabilityJudgement['cellStatus'];
}
export interface Preregistration {
  readonly id: string; readonly registeredAt: number; readonly stage: 'draft' | 'T0';
  readonly approvalRef: ArtifactRef | null; readonly candidate: AssetRevision; readonly baseDigest: string;
  readonly protocolRef: ArtifactRef; readonly analysisScriptRef: ArtifactRef;
  readonly dataSplitRefs: readonly ArtifactRef[]; readonly partition: DataSplit['partition'];
  readonly hosts: readonly HostBinding[]; readonly authors: readonly ActorRef[];
  readonly comparisons: readonly Comparison[]; readonly plannedN: 160 | 165;
  readonly trialIds: readonly string[]; readonly seeds: readonly number[];
  readonly orderSeed: number; readonly bootstrapSeed: number; readonly bootstrapReplicates: 10000;
  readonly selectionRule: 'all-required'; readonly primaryMetric: 'task_success';
  readonly secondaryMetrics: readonly ['quality_score', 'itt_composite'];
  readonly stopping: { readonly confirmatoryN: number; readonly futilityN: number | null; readonly futilityThreshold: 0.20 };
  readonly sampling: { readonly temperature: number; readonly topP: number };
  readonly envelopes: readonly EvaluationEnvelope[]; readonly budget: BudgetPolicy | null;
  readonly evidenceKind: 'fixture' | 'offline' | 'unseen';
}
export interface RegisteredPlan {
  readonly ref: ArtifactRef; readonly plan: Preregistration; readonly splits: readonly DataSplit[];
  readonly budgetAuthorized: boolean; readonly t0Approved: boolean;
}
export interface Run {
  readonly runId: string; readonly startedAt: number; readonly registrationRef: ArtifactRef;
  readonly trialId: string; readonly seed: number; readonly instanceId: string; readonly hostId: string; readonly arm: Arm;
  readonly candidate: AssetRef | null; readonly baseDigest: string; readonly hostVersion: string;
  readonly model: ModelBinding; readonly protocolRef: ArtifactRef;
  readonly sampling: Preregistration['sampling'];
  readonly toolsetDigest: string; readonly authorityDigest: string; readonly envelope: EvaluationEnvelope;
  readonly status: 'completed' | 'incomplete' | 'timeout' | 'cancelled' | 'usage_incomplete' | 'needs-human' | 'unknown';
  readonly artifactRefs: readonly ArtifactRef[]; readonly actualDiffRef: ArtifactRef;
  readonly usage: readonly Usage[]; readonly wallMs: number; readonly humanWaitMs: number;
  readonly authorVisibleRefs: readonly ArtifactRef[]; readonly pollutionFound: boolean;
}
/** The independent pipeline sees opaque artifacts/checks, never arm labels or author reasoning. */
export interface BlindInput {
  readonly opaqueId: string; readonly artifacts: readonly string[]; readonly actualDiff: string;
  readonly contract: string; readonly privateTests: string; readonly requiredBranches: readonly string[];
}
export interface Verification {
  readonly privateTestsPassed: boolean | null; readonly outcomesMet: boolean | null;
  readonly branches: readonly { readonly id: string; readonly passed: boolean | null }[];
  readonly qualityScore: number | null; readonly qualityReliable: boolean;
  readonly evidenceRefs: readonly ArtifactRef[]; readonly usage: readonly Usage[]; readonly requestIds: readonly string[];
}
export interface IndependentVerifier {
  readonly issuer: ActorRef; readonly version: string;
  verify(input: BlindInput): StoreResult<Verification>;
}
/** Trusted ports are injected by the owning application, never taken from candidate material. */
export interface EvolutionPorts {
  readonly artifacts: ArtifactStore; readonly digest: DigestPort; readonly verifier: IndependentVerifier;
  readonly analysisScriptRef: ArtifactRef;
  readonly authority: {
    /** Checks a real approval/budget proof tied to the entire preregistration, not an id string. */
    authorize(action: 'T0' | 'budget', planRef: ArtifactRef, proof: ArtifactRef, at: number): StoreResult<true>;
    /** Durable signature or trusted origin sidecar, outside the frozen wire object. */
    attest(ref: ArtifactRef): StoreResult<true>;
    verify(ref: ArtifactRef): StoreResult<true>;
  };
  readonly journal: {
    hasStarted(registrationId: string): StoreResult<boolean>;
    /** Complete inventory including failed, cheap, cancelled and implicit work; no caller subset. */
    runs(registrationRef: ArtifactRef): StoreResult<readonly ArtifactRef[]>;
    requestIds(runRef: ArtifactRef): StoreResult<readonly string[]>;
    evidenceKind(runRef: ArtifactRef): StoreResult<Preregistration['evidenceKind']>;
  };
}
export interface Registration { readonly issuer: ActorRef; readonly version: string }
export interface Observation {
  readonly run: Run; readonly ref: ArtifactRef; readonly success: 0 | 1;
  readonly quality: number | null; readonly qualityReliable: boolean;
  readonly costMicros: number | null; readonly usageComplete: boolean;
  readonly incomplete: boolean; readonly uncertain: boolean; readonly polluted: boolean;
  readonly judgingCostMicros: number | null; readonly judgingUsageComplete: boolean;
  readonly retainedReservationMicros: number;
  readonly requestCount: number;
  readonly evidenceRefs: readonly ArtifactRef[];
}
export interface Pair { readonly sample: Sample; readonly control: Observation; readonly treatment: Observation }
export interface Statistics {
  readonly n: number; readonly n01: number; readonly n10: number; readonly delta: number | null;
  readonly se: number | null; readonly zMve: number | null; readonly bca95: readonly [number, number] | null;
  readonly conditionalPower: number | null; readonly bootstrapDigest: string;
  readonly exactMcNemarP: number; readonly scoreNullSe: number | null;
  readonly bcaMvePositive: boolean | null;
}
export type DecisionRecord = Omit<Decoded<'DecisionRecord'>,
  'issuer' | 'inputs' | 'evaluationReceiptRef' | 'evaluationProtocolRef' | 'evidenceRefs' | 'capabilityJudgement'> & {
  readonly issuer: ActorRef; readonly inputs: readonly ArtifactRef[]; readonly evaluationReceiptRef: ArtifactRef;
  readonly evaluationProtocolRef: ArtifactRef; readonly evidenceRefs: readonly ArtifactRef[];
  readonly capabilityJudgement: CapabilityJudgement;
};
export interface EvolutionEvaluation {
  readonly receipt: EvaluationReceipt; readonly receiptRef: ArtifactRef;
  readonly decision: DecisionRecord; readonly decisionRef: ArtifactRef;
  readonly benefitClaimAllowed: boolean; readonly reasons: readonly string[];
}
