/**
 * Capability negotiation (`INTERFACES.md` §7, `adr_0003`): TaskContract requirements against a
 * host's evidence-backed manifest. This is the one admission function; there is no brand whitelist
 * and `identity.host` / `identity.vendor` are never read, so swapping those labels cannot change a
 * result.
 *
 * A requirement is satisfied only by a `verified` capability whose pinned host version, coverage
 * tags and evidence kinds all match. A missing key is `unknown`, never "the other host probably
 * has it". A `degradable` gap may be closed by a task-declared alternative that is itself fully
 * hard-satisfied and carries a real approval binding; an unapproved-but-technically-met
 * alternative yields `needs-degradation`, which is not dispatchable.
 *
 * Digests are parameters: `taskDigest`/`manifestDigest` are produced by an injected DigestPort
 * outside this pure function.
 */
import { fail, offersVersion } from '../../protocol/index.js';
import type { Decoded } from '../../protocol/index.js';
import type { PolicyResult } from './types.js';
import type {
  ArtifactRef,
  DegradationOption,
  EvidenceRef,
  GuaranteeGap,
  GuaranteeRequirement,
  HostManifest,
  NegotiationResult,
  TaskContract,
} from './wire.js';

type Requirement = GuaranteeRequirement;
type Alternative = DegradationOption;
type Gap = GuaranteeGap;
type GapReason = Gap['reason'];

/** A PolicyPort-verified approval, already bound to the exact task/manifest/alternative digests. */
export interface ApprovalBinding {
  readonly alternativeId: string;
  readonly approvalRef: ArtifactRef;
}

export interface NegotiationInput {
  readonly task: TaskContract;
  readonly manifest: HostManifest;
  readonly taskDigest: Decoded<'Digest'>;
  readonly manifestDigest: Decoded<'Digest'>;
  readonly approvals: readonly ApprovalBinding[];
}

type Verdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: GapReason; readonly evidenceRefs: readonly EvidenceRef[] };

/**
 * `satisfies(r, manifest)` from `INTERFACES.md` §7. Reasons are checked in a fixed order so the
 * same inputs always produce the same gap classification.
 */
export function satisfiesRequirement(requirement: Requirement, manifest: HostManifest): Verdict {
  if (!Object.hasOwn(manifest.capabilities, requirement.capability)) {
    return { ok: false, reason: 'missing', evidenceRefs: [] };
  }
  const observation = manifest.capabilities[requirement.capability];
  if (observation.status !== 'verified') {
    const reason: GapReason = observation.status === 'partial' ? 'partial' : observation.status === 'absent' ? 'absent' : 'unknown';
    return { ok: false, reason, evidenceRefs: observation.evidenceRefs };
  }
  if (observation.scope.hostVersion !== manifest.identity.version) {
    return { ok: false, reason: 'version', evidenceRefs: observation.evidenceRefs };
  }
  if (requirement.evidenceKinds.includes('provider-live') && observation.scope.providerModel === null) {
    return { ok: false, reason: 'evidence-kind', evidenceRefs: observation.evidenceRefs };
  }
  const coverage = new Set(observation.scope.coverage);
  if (!requirement.coverage.every((tag) => coverage.has(tag))) {
    return { ok: false, reason: 'coverage', evidenceRefs: observation.evidenceRefs };
  }
  for (const kind of requirement.evidenceKinds) {
    if (!observation.evidenceRefs.some((ref) => ref.kind === kind && ref.claim.length > 0)) {
      return { ok: false, reason: 'evidence-kind', evidenceRefs: observation.evidenceRefs };
    }
  }
  return { ok: true };
}

/** A delegation whose requirements name alternatives that lead back to it is not a valid substitute. */
function namesAlternativeCycle(task: TaskContract, alternative: Alternative): boolean {
  const alternativesById = new Map(task.degradations.map((option) => [option.alternativeId, option]));
  const seen = new Set<string>();
  const stack = alternative.requirements.flatMap((requirement) => [...requirement.alternativeIds]);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === alternative.alternativeId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = alternativesById.get(id);
    if (next !== undefined) stack.push(...next.requirements.flatMap((requirement) => [...requirement.alternativeIds]));
  }
  return false;
}

/**
 * Technical side of an alternative: it replaces exactly the failed capability, its own guarantees
 * are all hard and satisfied, and it is not recursive. Approval is checked separately.
 */
function alternativeMeets(alternative: Alternative, original: Requirement, task: TaskContract, manifest: HostManifest): boolean {
  if (alternative.replacesCapability !== original.capability) return false;
  if (alternative.tradeoff.length === 0) return false;
  if (alternative.requirements.some((requirement) => requirement.mode !== 'hard')) return false;
  if (alternative.requirements.some((requirement) => requirement.capability === original.capability)) return false;
  if (alternative.requirements.some((requirement) => !satisfiesRequirement(requirement, manifest).ok)) return false;
  return !namesAlternativeCycle(task, alternative);
}

/**
 * The ordered algorithm from `INTERFACES.md` §7. Returns `EFK_PROTOCOL_UNSUPPORTED` when the host
 * does not offer the task's exact protocol pair, and `EFK_SCHEMA_INVALID` when the same capability
 * is required twice (the algorithm's "no duplicate capability" precondition).
 */
export function negotiate(input: NegotiationInput): PolicyResult<NegotiationResult> {
  const { task, manifest } = input;

  if (!offersVersion(manifest.compatibleProtocols, task.protocol)) {
    return {
      ok: false,
      error: fail(
        'EFK_PROTOCOL_UNSUPPORTED',
        `manifest does not offer ${task.protocol.namespace}@${task.protocol.schemaVersion}`,
        [manifest.manifestId],
      ),
    };
  }

  const requirements = [...task.requiredGuarantees].sort((left, right) =>
    left.capability < right.capability ? -1 : left.capability > right.capability ? 1 : 0,
  );
  if (new Set(requirements.map((requirement) => requirement.capability)).size !== requirements.length) {
    return {
      ok: false,
      error: fail('EFK_SCHEMA_INVALID', 'requiredGuarantees names the same capability more than once', [task.taskId]),
    };
  }

  const approvedByAlternative = new Map(input.approvals.map((binding) => [binding.alternativeId, binding.approvalRef]));
  const satisfied: string[] = [];
  const gaps: Gap[] = [];
  const selectedAlternatives: string[] = [];
  const approvalRefs: ArtifactRef[] = [];
  let unsupported = false;
  let pendingApproval = false;

  for (const requirement of requirements) {
    const verdict = satisfiesRequirement(requirement, manifest);
    if (verdict.ok) {
      satisfied.push(requirement.capability);
      continue;
    }
    gaps.push({
      capability: requirement.capability,
      reason: verdict.reason,
      evidenceRefs: verdict.evidenceRefs,
      alternativeIds: requirement.alternativeIds,
    });
    if (requirement.mode === 'hard') {
      unsupported = true;
      continue;
    }
    const candidates = task.degradations
      .filter((option) => requirement.alternativeIds.includes(option.alternativeId))
      .sort((left, right) => (left.alternativeId < right.alternativeId ? -1 : left.alternativeId > right.alternativeId ? 1 : 0));
    let chosen: Alternative | null = null;
    let chosenApproval: ArtifactRef | null = null;
    let technicallyMet = false;
    for (const candidate of candidates) {
      if (!alternativeMeets(candidate, requirement, task, manifest)) continue;
      technicallyMet = true;
      const approval = approvedByAlternative.get(candidate.alternativeId);
      if (candidate.approvalRef !== null && approval !== undefined) {
        chosen = candidate;
        chosenApproval = approval;
        break;
      }
    }
    if (chosen !== null && chosenApproval !== null) {
      selectedAlternatives.push(chosen.alternativeId);
      approvalRefs.push(chosenApproval);
    } else if (!technicallyMet) {
      unsupported = true;
    } else {
      pendingApproval = true;
    }
  }

  return {
    ok: true,
    value: {
      status: unsupported ? 'unsupported' : pendingApproval ? 'needs-degradation' : 'executable',
      taskDigest: input.taskDigest,
      manifestDigest: input.manifestDigest,
      satisfied,
      gaps,
      selectedAlternatives,
      approvalRefs,
    },
  };
}
