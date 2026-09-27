/**
 * Gate domain · contract gate, policy half.
 *
 * Two jobs, both ported from 0.3.0:
 *   - `requireEvidenceConfigured` (`src/lib/policy.js:155-161`): a run may not start without a
 *     hard invariant or a public evidence command, nor require objective improvement without an
 *     objective command. Same codes, same messages.
 *   - the policy-drift comparison (`src/lib/runner.js:140-149`, `:552`, `:638`, `:763`): three
 *     digests (`contract`, `holdout`, `config`) captured at run start and re-read after every
 *     agent phase. Any difference is the contract gate's QUARANTINE trigger.
 *
 * Imports: `src/types/**`, the shared base leaf `src/lib/errors.js`, and sibling gate modules.
 */

import type { EvoFenceContract } from '../../types/config.js';
import type { ContractGateInput, ContractGateResult, PolicyDocument, PolicyHashes } from '../../types/gate.js';
import { EvoFenceError } from '../errors.js';
import type { GateJudgementBase } from './fail-closed.js';
import { failingJudgement, isNonEmptyString, isRecord, passingJudgement, refusedJudgement } from './fail-closed.js';

/** The contract slice this module reads. */
export type EvidenceConfigContract = Pick<EvoFenceContract, 'hard_invariants' | 'evidence' | 'acceptance' | 'objective'>;

/** Refuse a run whose contract configures no evidence, or no objective it then demands. */
export function requireEvidenceConfigured(contract: EvidenceConfigContract): void {
  if (!contract.hard_invariants.length && !contract.evidence.public_commands.length) {
    throw new EvoFenceError('NO_EVIDENCE_CONFIGURED', 'Add at least one hard invariant or public evidence command to .evofence/contract.yaml before running an evolution loop.');
  }
  if (contract.acceptance.require_objective_improvement && !contract.objective.command.trim()) {
    throw new EvoFenceError('OBJECTIVE_NOT_CONFIGURED', 'Set objective.command to a trusted command that prints a numeric score before running the evolution loop.');
  }
}

/** The order drift is attributed in when several documents changed at once. */
export const POLICY_DOCUMENTS: readonly PolicyDocument[] = ['contract', 'holdout', 'config'];

/** Compare two digest triples; `changed` names the first differing document. */
export function comparePolicyHashes(initial: PolicyHashes, current: PolicyHashes): ContractGateResult {
  const changed = POLICY_DOCUMENTS.find((document) => initial[document] !== current[document]) ?? null;
  return { drifted: changed !== null, changed };
}

/** Contract-gate judgement: the three policy documents are unchanged since run start. */
export interface ContractGateJudgement extends GateJudgementBase, ContractGateResult {}

function digestMissing(hashes: unknown, prefix: string, missing: string[]): boolean {
  if (!isRecord(hashes)) {
    missing.push(prefix);
    return true;
  }
  for (const document of POLICY_DOCUMENTS) {
    if (!isNonEmptyString(hashes[document])) missing.push(`${prefix}.${document}`);
  }
  return false;
}

/**
 * Independent contract-gate entry point.
 *
 * Fail-closed: an absent or incomplete digest set reports `drifted: true` with the offending
 * fields, so an unreadable policy document can never be mistaken for "no drift".
 *
 * `phase` (PROPOSAL / RUN / EVALUATION) only chooses the reason literal; the runner keeps its
 * own literals (`POLICY_CHANGED_DURING_PROPOSAL` …) until it is wired to this entry point.
 */
export function evaluateContractGate(
  input: ContractGateInput | null | undefined,
  phase?: string,
): ContractGateJudgement {
  const missing: string[] = [];
  const drifted = { drifted: true, changed: null as PolicyDocument | null };
  if (!isRecord(input)) return failingJudgement(['input'], drifted);
  const candidate = input as unknown as Record<string, unknown>;
  digestMissing(candidate.initial, 'initial', missing);
  digestMissing(candidate.current, 'current', missing);
  if (missing.length) return failingJudgement(missing, drifted);

  const result = comparePolicyHashes(candidate.initial as PolicyHashes, candidate.current as PolicyHashes);
  if (!result.drifted) return passingJudgement({ drifted: false, changed: null as PolicyDocument | null });
  const reason = phase ? `POLICY_CHANGED_DURING_${phase}` : 'POLICY_CHANGED';
  return refusedJudgement(reason, result);
}
