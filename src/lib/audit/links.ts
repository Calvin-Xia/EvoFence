/**
 * Acceptance-link verification: the `LEDGER_CORRUPT` cluster behind `evofence diff`.
 *
 * Ported statement-for-statement from `src/lib/audit.js:22-247`. Every branch, message and
 * ordering decision is preserved verbatim: 30 `spec-f1` cases assert these messages with
 * regexes, and the audit view is the F1 acceptance oracle. The audit is FAIL-CLOSED — any
 * ambiguity (two matching proposals, a missing gate decision, a baseline from another branch)
 * throws instead of picking a candidate.
 *
 * Payload-derived values are typed `any` from {@link payloadOf}: the audit walks values that
 * may have been tampered with, so the guards below — not the type system — are the contract.
 * The `event.seq < accepted.seq` filter appears in every lookup on purpose: the chain order is
 * what makes a link "preceding" and therefore non-retroactive (`docs/refactor-inventory.md` §4.3).
 */

import type { GenerationRecord, LedgerEvent } from '../../types/ledger.js';
import { EvoFenceError } from '../errors.js';
import { sha256, stableStringify } from '../fs.js';
import { payloadOf } from './payload.js';

/** Latest event in chain order matching `predicate`, or `null`. */
function latestEvent(events: LedgerEvent[], predicate: (event: LedgerEvent) => boolean): LedgerEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

/** The newest `candidate.accepted` event for a generation, or `null`. */
export function acceptedEvent(events: LedgerEvent[], generationId: string): LedgerEvent | null {
  return latestEvent(events, (event) => event.event_type === 'candidate.accepted' && payloadOf(event).generation_id === generationId);
}

/** A claimed `proposal_sha256` must be reproducible from the proposal it points at. */
function verifyProposalDigestClaim(event: LedgerEvent): void {
  const claim = payloadOf(event).proposal_sha256;
  if (typeof claim !== 'string') return;
  const proposal = payloadOf(event).proposal;
  if (!proposal || typeof proposal !== 'object') {
    throw new EvoFenceError('LEDGER_CORRUPT', `proposal.created digest claim ${claim} has no proposal object to recompute.`);
  }
  const computed = sha256(stableStringify(proposal));
  if (computed !== claim) {
    throw new EvoFenceError('LEDGER_CORRUPT', `proposal.created digest claim ${claim} does not match its proposal content (computed ${computed}).`);
  }
}

/** Every linked record must name the accepted parent, so links cannot cross generations. */
function verifyLinkedBaseSha(event: LedgerEvent, parentSha: any, label: string, generationId: any): void {
  const base = payloadOf(event).base_sha;
  if (base !== parentSha) {
    throw new EvoFenceError('LEDGER_CORRUPT', `${label} base_sha ${base ?? 'missing'} disagrees with the accepted parent ${parentSha} for generation ${generationId ?? 'unknown'}.`);
  }
}

/** The embedded proposal must agree with the acceptance about the base commit. */
function verifyProposalLink(event: LedgerEvent, accepted: LedgerEvent): void {
  const parentSha = payloadOf(accepted).parent_sha;
  const generationId = payloadOf(accepted).generation_id ?? 'unknown';
  verifyLinkedBaseSha(event, parentSha, 'proposal.created', generationId);
  const proposal = payloadOf(event).proposal;
  if (proposal && typeof proposal === 'object' && proposal.base_sha !== parentSha) {
    throw new EvoFenceError('LEDGER_CORRUPT', `proposal.created proposal.base_sha ${proposal.base_sha ?? 'missing'} disagrees with the accepted parent ${parentSha} for generation ${generationId}.`);
  }
}

/**
 * Resolves the `proposal.created` event bound to an acceptance: by digest when the acceptance
 * carries one, otherwise by `(run_id, iteration)` for legacy acceptances. Ambiguity throws.
 */
export function proposalEventFor(events: LedgerEvent[], accepted: LedgerEvent): LedgerEvent | null {
  const digest = payloadOf(accepted).proposal_sha256;
  if (typeof digest === 'string') {
    const byDigest = events.filter((event) => event.event_type === 'proposal.created'
      && event.run_id === accepted.run_id && event.seq < accepted.seq && payloadOf(event).proposal_sha256 === digest);
    if (!byDigest.length) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted proposal_sha256 ${digest} matches no proposal.created event for run ${accepted.run_id}.`);
    }
    if (byDigest.length > 1) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted proposal_sha256 ${digest} matches ${byDigest.length} proposal.created events for run ${accepted.run_id}; the proposal link is ambiguous.`);
    }
    verifyProposalDigestClaim(byDigest[0]);
    verifyProposalLink(byDigest[0], accepted);
    return byDigest[0];
  }
  const byIteration = events.filter((event) => event.event_type === 'proposal.created'
    && event.run_id === accepted.run_id && event.seq < accepted.seq && payloadOf(event).iteration === payloadOf(accepted).iteration);
  if (byIteration.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted iteration ${payloadOf(accepted).iteration} matches ${byIteration.length} proposal.created events for run ${accepted.run_id}; the proposal link is ambiguous.`);
  }
  if (byIteration[0]) {
    verifyProposalDigestClaim(byIteration[0]);
    verifyProposalLink(byIteration[0], accepted);
  }
  return byIteration[0] ?? null;
}

/** Resolves the `evidence.candidate` event bound to an acceptance, by artifact then iteration. */
export function evidenceEventFor(events: LedgerEvent[], accepted: LedgerEvent): LedgerEvent | null {
  const candidates = events.filter((event) => event.event_type === 'evidence.candidate'
    && event.run_id === accepted.run_id && event.seq < accepted.seq && payloadOf(event).iteration === payloadOf(accepted).iteration);
  const artifact = payloadOf(accepted).evidence_artifact;
  if (typeof artifact === 'string') {
    const bound = candidates.filter((event) => payloadOf(event).evidence?.artifact === artifact);
    if (bound.length !== 1) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted evidence_artifact ${artifact} matches ${bound.length} evidence.candidate events for run ${accepted.run_id} iteration ${payloadOf(accepted).iteration}; expected exactly one.`);
    }
    verifyLinkedBaseSha(bound[0], payloadOf(accepted).parent_sha, 'evidence.candidate', payloadOf(accepted).generation_id);
    return bound[0];
  }
  if (candidates.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted iteration ${payloadOf(accepted).iteration} matches ${candidates.length} evidence.candidate events for run ${accepted.run_id}; the evidence link is ambiguous.`);
  }
  if (candidates[0]) verifyLinkedBaseSha(candidates[0], payloadOf(accepted).parent_sha, 'evidence.candidate', payloadOf(accepted).generation_id);
  return candidates[0] ?? null;
}

/** The run's contract snapshot source: exactly one `run.started` before the acceptance. */
export function runStartedEventFor(events: LedgerEvent[], runId: string | null, beforeSeq = Infinity): LedgerEvent | null {
  if (typeof runId !== 'string' || !runId) return null;
  const matches = events.filter((event) => event.event_type === 'run.started' && event.run_id === runId && event.seq < beforeSeq);
  if (matches.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `run ${runId} has ${matches.length} run.started events before the acceptance; the contract snapshot is ambiguous.`);
  }
  return matches[0] ?? null;
}

const GENERATION_RECORD_KEYS: readonly (keyof GenerationRecord)[] = ['run_id', 'sha', 'parent_sha', 'created_at'];

/** The `generations` row must be an exact projection of its hash-chained record. */
export function verifyGenerationMetadata(events: LedgerEvent[], generation: GenerationRecord): void {
  const recordEvents = events.filter((event) => event.event_type === 'generation.accepted'
    && payloadOf(event).generation_id === generation.generation_id);
  if (!recordEvents.length) {
    throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} has no hash-chained generation.accepted record.`);
  }
  if (recordEvents.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} has ${recordEvents.length} generation.accepted records; the association is ambiguous.`);
  }
  const record = payloadOf(recordEvents[0]);
  for (const key of GENERATION_RECORD_KEYS) {
    if (record[key] !== generation[key]) {
      throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} ${key} disagrees with its hash-chained generation.accepted record.`);
    }
  }
  const acceptedEvents = events.filter((event) => event.event_type === 'candidate.accepted'
    && payloadOf(event).generation_id === generation.generation_id);
  if (acceptedEvents.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} has ${acceptedEvents.length} candidate.accepted events; the acceptance record is ambiguous.`);
  }
  for (const event of acceptedEvents) {
    if (event.run_id !== generation.run_id) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted evidence for generation ${generation.generation_id} is recorded under run ${event.run_id ?? 'null'} instead of ${generation.run_id ?? 'null'}.`);
    }
    if (payloadOf(event).sha !== generation.sha || payloadOf(event).parent_sha !== generation.parent_sha) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted evidence disagrees with generation ${generation.generation_id} metadata.`);
    }
  }
}

/** Exactly one preceding `gate.decision` per accepted iteration, and it must be a passing ACCEPT. */
export function verifyGateDecision(events: LedgerEvent[], accepted: LedgerEvent | null): void {
  if (!accepted) return;
  const iteration = payloadOf(accepted).iteration;
  const decisions = events.filter((event) => event.event_type === 'gate.decision'
    && event.run_id === accepted.run_id
    && event.seq < accepted.seq
    && typeof iteration === 'number'
    && payloadOf(event).iteration === iteration);
  const passing = decisions.filter((event) => payloadOf(event).decision === 'ACCEPT');
  if (decisions.length !== 1 || passing.length !== 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted for generation ${payloadOf(accepted).generation_id ?? 'unknown'} has ${decisions.length} gate.decision records (${passing.length} ACCEPT); a unique preceding ACCEPT gate decision is required.`);
  }
  const gate = payloadOf(passing[0]);
  if (gate.evidence_ok !== true) {
    throw new EvoFenceError('LEDGER_CORRUPT', `the ACCEPT gate decision for generation ${payloadOf(accepted).generation_id ?? 'unknown'} records evidence_ok=${gate.evidence_ok === true}; expected true.`);
  }
  if (gate.improvement !== payloadOf(accepted).improvement) {
    throw new EvoFenceError('LEDGER_CORRUPT', `the ACCEPT gate decision improvement ${gate.improvement} disagrees with candidate.accepted improvement ${payloadOf(accepted).improvement} for generation ${payloadOf(accepted).generation_id ?? 'unknown'}.`);
  }
  verifyLinkedBaseSha(passing[0], payloadOf(accepted).parent_sha, 'gate.decision', payloadOf(accepted).generation_id);
}

/** The bound evidence must itself have passed its gate, and the recorded score must match it. */
export function verifyAcceptanceEvidence(accepted: LedgerEvent | null, evidenceEvent: LedgerEvent | null, generationId: string): void {
  if (!accepted) return;
  const evidence = payloadOf(evidenceEvent).evidence ?? null;
  if (evidence && (evidence.all_public_passed !== true || evidence.all_private_within_tolerance !== true)) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted for generation ${generationId} is bound to evidence that did not pass its gate (all_public_passed=${evidence.all_public_passed === true}, all_private_within_tolerance=${evidence.all_private_within_tolerance === true}).`);
  }
  if (evidence && evidence.objective?.valid_score !== true) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted for generation ${generationId} is bound to evidence with objective.valid_score=${evidence.objective?.valid_score === true}; the acceptance predicate requires a valid score.`);
  }
  if (typeof payloadOf(accepted).objective_score === 'number') {
    const evidenceScore = evidence?.objective?.score;
    if (evidenceScore !== payloadOf(accepted).objective_score) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted objective_score ${payloadOf(accepted).objective_score} disagrees with bound evidence score ${evidenceScore === undefined ? 'missing' : evidenceScore} for generation ${generationId}.`);
    }
  }
}

/** The score an accepted generation improved on: the previous acceptance, or the run baseline. */
export function improvementBaselineScore(events: LedgerEvent[], accepted: LedgerEvent): number | null {
  const previous = latestEvent(events, (event) => event.event_type === 'candidate.accepted'
    && event.run_id === accepted.run_id && event.seq < accepted.seq);
  if (previous) {
    if (payloadOf(previous).sha !== payloadOf(accepted).parent_sha) {
      throw new EvoFenceError('LEDGER_CORRUPT', `prior acceptance sha ${payloadOf(previous).sha ?? 'missing'} disagrees with the accepted parent ${payloadOf(accepted).parent_sha ?? 'missing'} for generation ${payloadOf(accepted).generation_id ?? 'unknown'}; the improvement baseline is from another branch.`);
    }
    verifyGateDecision(events, previous);
    verifyAcceptanceEvidence(previous, evidenceEventFor(events, previous), payloadOf(previous).generation_id ?? 'unknown');
    const score = payloadOf(previous).objective_score;
    return typeof score === 'number' ? score : null;
  }
  const baselines = events.filter((event) => event.event_type === 'evidence.baseline'
    && event.run_id === accepted.run_id && event.seq < accepted.seq);
  if (baselines.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `${baselines.length} evidence.baseline events precede the acceptance of generation ${payloadOf(accepted).generation_id ?? 'unknown'}; the baseline is ambiguous.`);
  }
  if (!baselines.length) return null;
  const baseline = payloadOf(baselines[0]);
  const baselineGateOk = baseline.all_public_passed === true
    && baseline.all_private_within_tolerance === true
    && baseline.objective?.valid_score === true;
  if (!baselineGateOk) {
    throw new EvoFenceError('LEDGER_CORRUPT', `evidence.baseline for run ${accepted.run_id} did not pass its gate (all_public_passed=${baseline.all_public_passed === true}, all_private_within_tolerance=${baseline.all_private_within_tolerance === true}, objective.valid_score=${baseline.objective?.valid_score === true}); it cannot substantiate an improvement.`);
  }
  const score = baseline.objective?.objective?.score ?? baseline.objective?.score;
  return typeof score === 'number' ? score : null;
}

/**
 * `improvement` must be recomputable from ledger evidence in the contract's direction and must
 * clear the contract's `min_delta`. The direction is never assumed.
 */
export function verifyImprovementEvidence(
  events: LedgerEvent[],
  accepted: LedgerEvent | null,
  runStartedEvent: LedgerEvent | null,
  generationId: string,
): void {
  if (!accepted) return;
  const improvement = payloadOf(accepted).improvement;
  const score = payloadOf(accepted).objective_score;
  if (typeof improvement !== 'number' || typeof score !== 'number') {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted for generation ${generationId} lacks a numeric objective_score/improvement; the acceptance predicate requires both.`);
  }
  const direction = payloadOf(runStartedEvent).contract_snapshot?.objective?.direction;
  const baselineScore = improvementBaselineScore(events, accepted);
  if (baselineScore === null || typeof direction !== 'string') {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted improvement ${improvement} for generation ${generationId} cannot be derived from ledger evidence.`);
  }
  const expected = direction === 'maximize' ? score - baselineScore : baselineScore - score;
  if (expected !== improvement) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted improvement ${improvement} disagrees with ledger evidence (expected ${expected}) for generation ${generationId}.`);
  }
  const minDelta = payloadOf(runStartedEvent).contract_snapshot?.objective?.min_delta;
  if (typeof minDelta !== 'number' || !(improvement >= minDelta)) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted improvement ${improvement} for generation ${generationId} does not meet the contract min_delta ${minDelta === undefined ? 'missing' : minDelta}.`);
  }
}
