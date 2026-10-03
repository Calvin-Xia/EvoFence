/** In-process measurement types; the wire objects retain the frozen field names. */
import type { Decoded } from '../../protocol/index.js';
import type { ActorRef, ArtifactRef, Binding, SchemaRef, AdmittedArtifact } from '../artifacts/index.js';
import type { DigestPort, StoreResult } from '../store/index.js';

export type TaskContract = Omit<Decoded<'TaskContract'>,
  'protocol' | 'acceptance' | 'requiredOutcomes' | 'scope' | 'privacy' | 'termination'> & {
  readonly protocol: Decoded<'ProtocolVersion'>;
  readonly acceptance: Omit<Decoded<'AcceptancePolicy'>, 'checkRefs' | 'outcomeSchema' | 'protocolRef'> & {
    readonly checkRefs: readonly ArtifactRef[]; readonly outcomeSchema: SchemaRef;
    readonly protocolRef: ArtifactRef | null;
  };
  readonly requiredOutcomes: readonly (Omit<Decoded<'OutcomeRequirement'>, 'schema'> & { readonly schema: SchemaRef })[];
  readonly scope: Omit<Decoded<'Scope'>, 'workspaceRef'> & { readonly workspaceRef: ArtifactRef | null };
  readonly privacy: Decoded<'PrivacyPolicy'>;
  readonly termination: Decoded<'TerminationPolicy'>;
};
export type BranchEvidence = Omit<Decoded<'BranchEvidence'>, 'binding' | 'state' | 'artifactRefs' | 'decisionRef' | 'gapReason'> & {
  readonly binding: Binding | null; readonly state: Decoded<'NodeState'> | null;
  readonly artifactRefs: readonly ArtifactRef[]; readonly decisionRef: ArtifactRef | null;
  readonly gapReason: string | null;
};
export type TaskEvidenceReport = Omit<Decoded<'TaskEvidenceReport'>,
  'binding' | 'contractRef' | 'branchReport' | 'artifactRefs' | 'actualDiffRef'> & {
  readonly binding: Binding; readonly contractRef: Decoded<'ContractRef'>;
  readonly branchReport: readonly BranchEvidence[]; readonly artifactRefs: readonly ArtifactRef[];
  readonly actualDiffRef: ArtifactRef | null;
};
export type TaskOutcome = 'completed' | 'repair' | 'failed' | 'needs-human' | 'unknown';
export type DecisionRecord = Omit<Decoded<'DecisionRecord'>, 'kind' | 'outcome' | 'inputs' | 'contractRef' |
  'taskEvidenceRef' | 'evaluationReceiptRef' | 'activationReceiptRef' | 'evaluationProtocolRef' |
  'evidenceRefs' | 'issuer' | 'capabilityJudgement'> & {
  readonly kind: 'task'; readonly outcome: TaskOutcome;
  readonly inputs: readonly ArtifactRef[]; readonly contractRef: Decoded<'ContractRef'>;
  readonly taskEvidenceRef: ArtifactRef; readonly evaluationReceiptRef: null;
  readonly activationReceiptRef: null; readonly evaluationProtocolRef: null;
  readonly evidenceRefs: readonly ArtifactRef[]; readonly issuer: ActorRef; readonly capabilityJudgement: null;
};
export type Metric = 'tests' | 'outcome' | 'artifact' | 'host';
export interface Measurement {
  readonly metric: Metric;
  readonly status: 'passed' | 'failed' | 'unknown' | 'needs-human';
  readonly refs: readonly ArtifactRef[];
  readonly gapReason: string | null;
  readonly repair: string;
  readonly passRate: number | null;
  readonly outcomeIds: readonly string[];
}
export interface Provider {
  readonly id: string; readonly version: string; readonly metric: Metric;
  readonly schema: SchemaRef; readonly producer: ActorRef;
  readonly evidenceKind: Decoded<'EvidenceKind'>; readonly privateTests: boolean;
  measure(task: TaskContract, evidence: readonly AdmittedArtifact[]): StoreResult<Measurement>;
}
export interface Registration {
  readonly issuer: ActorRef; readonly version: string;
  readonly providers: readonly Provider[];
  /** All selected providers are mandatory; missing selection/measurement never means success. */
  readonly selected: readonly string[];
}
export interface EvaluationContext {
  readonly digest: DigestPort; readonly at: number;
  readonly binding: Binding;
  /** Current branch bindings from the journal, never the report's own claim of its attempt. */
  readonly branches: ReadonlyMap<string, Binding>;
  readonly evidence: readonly AdmittedArtifact[];
  readonly inputs: readonly ArtifactRef[];
  readonly repairAllowed: boolean;
}
export interface EvaluationGap {
  readonly status: Exclude<Measurement['status'], 'passed'>;
  readonly gapReason: string; readonly repair: string; readonly refs: readonly ArtifactRef[];
  readonly branchId: string | null;
}
export interface TaskEvaluation {
  readonly decision: DecisionRecord; readonly report: TaskEvidenceReport;
  readonly reportBytes: string; readonly measurements: readonly Measurement[];
  readonly gaps: readonly EvaluationGap[];
}
