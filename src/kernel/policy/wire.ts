/**
 * Refined views of the protocol objects this lane reads.
 *
 * `src/protocol/types.ts` derives `Decoded<K>` mechanically from the frozen field table, but its
 * `Wire` mapping resolves a nested `$ref` to `Record<string, unknown>` — enough for the codec, not
 * enough to read `scope.hostVersion` or `manifest.identity.version`. These aliases keep every field
 * name owned by the frozen table and only tighten the value type at the spots where `Wire` is
 * shallow, using `Decoded<'…'>` for the referenced object. There is no second copy of the schema.
 */
import type { Decoded } from '../../protocol/index.js';

export type ArtifactRef = Decoded<'ArtifactRef'>;
export type EvidenceRef = Decoded<'EvidenceRef'>;
export type ProtocolVersion = Decoded<'ProtocolVersion'>;
export type GuaranteeRequirement = Decoded<'GuaranteeRequirement'>;
export type DegradationOption = Omit<Decoded<'DegradationOption'>, 'requirements' | 'approvalRef'> & {
  readonly requirements: readonly GuaranteeRequirement[];
  readonly approvalRef: ArtifactRef | null;
};
export type GuaranteeGap = Decoded<'GuaranteeGap'>;
export type BudgetPolicy = Decoded<'BudgetPolicy'>;
export type Usage = Decoded<'Usage'>;

export type CapabilityObservation = Omit<Decoded<'CapabilityObservation'>, 'scope' | 'evidenceRefs'> & {
  readonly scope: Decoded<'CapabilityScope'>;
  readonly evidenceRefs: readonly EvidenceRef[];
};

export type HostManifest = Omit<Decoded<'HostManifest'>, 'identity' | 'compatibleProtocols' | 'capabilities'> & {
  readonly identity: Decoded<'HostIdentity'>;
  readonly compatibleProtocols: readonly ProtocolVersion[];
  readonly capabilities: Readonly<Record<string, CapabilityObservation>>;
};

export type Scope = Omit<Decoded<'Scope'>, 'workspaceRef'> & {
  readonly workspaceRef: ArtifactRef | null;
};

export type Grant = Omit<Decoded<'Grant'>, 'scope'> & {
  readonly scope: Scope;
};

export type TaskContract = Omit<Decoded<'TaskContract'>, 'protocol' | 'requiredGuarantees' | 'degradations'> & {
  readonly protocol: ProtocolVersion;
  readonly requiredGuarantees: readonly GuaranteeRequirement[];
  readonly degradations: readonly DegradationOption[];
};

export type NegotiationResult = Omit<Decoded<'NegotiationResult'>, 'gaps' | 'approvalRefs'> & {
  readonly gaps: readonly GuaranteeGap[];
  readonly approvalRefs: readonly ArtifactRef[];
};
