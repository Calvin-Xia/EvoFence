import type { Decoded, ErrorCode } from '../../protocol/index.js';
import type { ActorRef, ArtifactRef, ArtifactStore } from '../../kernel/artifacts/index.js';
import type { DigestPort, StoreResult } from '../../kernel/store/index.js';

export type Scope = Omit<Decoded<'Scope'>, 'workspaceRef'> & { readonly workspaceRef: ArtifactRef | null };
export type AssetRef = Omit<Decoded<'AssetRef'>, 'scope' | 'qualificationRef'> & {
  readonly scope: Scope; readonly qualificationRef: ArtifactRef | null;
};
export type CapabilityAsset = Omit<Decoded<'CapabilityAsset'>,
  'asset' | 'contentRefs' | 'sourceTraces' | 'dependencies' | 'evaluationRef' | 'revocationRef' | 'expiresAt'> & {
  readonly asset: AssetRef; readonly contentRefs: readonly ArtifactRef[]; readonly sourceTraces: readonly ArtifactRef[];
  readonly dependencies: readonly AssetRef[]; readonly evaluationRef: ArtifactRef | null;
  readonly revocationRef: ArtifactRef | null; readonly expiresAt: number | null;
};
export type ModelBinding = Omit<Decoded<'ModelRequirement'>, 'payloadRef' | 'providerModel' | 'reasoningRequested'> & {
  readonly payloadRef: ArtifactRef | null; readonly providerModel: string | null; readonly reasoningRequested: string | null;
};
export type CapabilityJudgement = Omit<Decoded<'CapabilityJudgement'>, 'protocolRef' | 'analysisRef'> & {
  readonly protocolRef: ArtifactRef; readonly analysisRef: ArtifactRef;
};
export type EvaluationReceipt = Omit<Decoded<'EvaluationReceipt'>,
  'candidate' | 'dependencyRefs' | 'protocolRef' | 'dataSplitRefs' | 'hostManifestRefs' | 'modelBindings' | 'requiredJudgements' | 'evidenceRefs'> & {
  readonly candidate: AssetRef; readonly dependencyRefs: readonly AssetRef[]; readonly protocolRef: ArtifactRef;
  readonly dataSplitRefs: readonly ArtifactRef[]; readonly hostManifestRefs: readonly ArtifactRef[];
  readonly modelBindings: readonly ModelBinding[]; readonly requiredJudgements: readonly CapabilityJudgement[];
  readonly evidenceRefs: readonly ArtifactRef[];
};
export type ActivationReceipt = Omit<Decoded<'ActivationReceipt'>,
  'asset' | 'scope' | 'previousSnapshot' | 'newSnapshot' | 'evaluationRef'> & {
  readonly asset: AssetRef; readonly scope: Scope; readonly previousSnapshot: ArtifactRef;
  readonly newSnapshot: ArtifactRef | null; readonly evaluationRef: ArtifactRef;
};
export type AssetCategory = 'graph-template' | 'strategy' | 'experience' | 'skill' | 'tool' | 'code-patch';
export interface Compatibility {
  readonly hosts: readonly { readonly hostId: string; readonly version: string; readonly manifestRef: ArtifactRef }[];
  readonly models: readonly ModelBinding[];
  readonly repositories: readonly { readonly repoId: string; readonly baseDigest: string }[];
  readonly taskIds: readonly string[];
  readonly protocolRef: ArtifactRef;
}
/** Local immutable metadata, not an extension of the frozen CapabilityAsset wire schema. */
export interface AssetRevision {
  readonly candidate: CapabilityAsset; readonly category: AssetCategory;
  readonly compatibility: Compatibility; readonly createdAt: number;
}
export type AssetState = 'staged' | 'validated' | 'promoted' | 'active' | 'revoked';
export interface QualificationContext {
  readonly hostId: string; readonly hostVersion: string; readonly hostManifestRef: ArtifactRef;
  readonly hostSessionId: string; readonly model: ModelBinding;
  readonly repoId: string; readonly baseDigest: string; readonly taskId: string;
  readonly scope: Scope; readonly at: number;
}
export interface RegistryEvent {
  readonly sequence: number; readonly asset: AssetRef; readonly at: number; readonly state: AssetState;
  readonly evidenceRef: ArtifactRef | null; readonly context: QualificationContext | null;
  readonly expiresAt: number | null;
}
/** Trusted, journal-derived snapshot. Plans must be committed by the caller's command/CAS path. */
export interface RegistrySnapshot {
  readonly revisions: readonly AssetRevision[]; readonly history: readonly RegistryEvent[];
}
export interface Qualification {
  readonly assetId: string; readonly revision: number; readonly digest: string;
  readonly state: AssetState; readonly validity: 'valid' | 'invalid' | 'unknown';
  readonly eligible: boolean; readonly usable: boolean; readonly reasons: readonly ErrorCode[];
}
export interface RegistryPorts {
  readonly digest: DigestPort; readonly artifacts: ArtifactStore;
  readonly issuers: Readonly<Record<'candidate' | 'promotion' | 'activation' | 'revocation', ActorRef>>;
  /** Current root/grant/lease/safe-idle judgement, injected by the owning command service. */
  authorize(action: 'promote' | 'activate' | 'revoke', asset: AssetRef,
    context: QualificationContext | null, authorizationRef: string | null, at: number): StoreResult<true>;
}
export interface DecisionInput {
  readonly asset: AssetRef; readonly decisionRef: ArtifactRef;
  readonly context: QualificationContext; readonly at: number;
}
