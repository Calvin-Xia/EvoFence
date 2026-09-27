/**
 * Gate domain · verdict mapping.
 *
 * The decision table 0.3.0 spells out inline at the end of an iteration
 * (`src/lib/runner.js:748-767`) plus the refusal-to-verdict mapping used twice for candidate
 * checks (`:699-701`, `:722-724`). Same literal reason strings, so the audit view
 * (`src/lib/audit.js`) and every ledger consumer keep reading identical payloads.
 *
 * `RISK_ASSESSMENT_MISSING` is the one addition: a decided-evidence pass with no risk assessment
 * cannot ACCEPT, because the band is what separates ACCEPT from ESCALATE/QUARANTINE.
 *
 * Imports: `src/types/**` + sibling gate modules.
 */

import type { GateDecision, GateReason, GateVerdict, RiskAssessment, RiskBand } from '../../types/gate.js';
import type { CandidateCheckCode } from '../../types/proposal.js';
import type { EvidenceGateJudgement } from './evidence.js';

/** An evidence verdict, plus the extra fields the `gate.decision` payload carries. */
export interface EvidenceVerdict extends GateVerdict {
  risk?: RiskAssessment;
  improvement?: number;
  min_delta?: number;
  private_regressions?: true;
}

/** `CAPABILITY_VIOLATION` escalates; `POLICY_VIOLATION` and evidence tampering quarantine. */
export function decisionForCandidateCheck(code: CandidateCheckCode): GateDecision {
  if (code === 'CAPABILITY_VIOLATION') return 'ESCALATE';
  if (code === 'POLICY_VIOLATION' || code === 'EVIDENCE_MODIFIED_CANDIDATE') return 'QUARANTINE';
  return 'REJECT';
}

/** The risk band's own verdict; `LOW`/`MEDIUM` clear the candidate. */
export function verdictForRisk(band: RiskBand, risk?: RiskAssessment): EvidenceVerdict {
  if (band === 'CRITICAL') return { decision: 'QUARANTINE', reason: 'CRITICAL_CHANGE_RISK', ...(risk ? { risk } : {}) };
  if (band === 'HIGH') return { decision: 'ESCALATE', reason: 'HIGH_CHANGE_RISK', ...(risk ? { risk } : {}) };
  return { decision: 'ACCEPT', reason: 'ALL_REQUIRED_EVIDENCE_PASSED', ...(risk ? { risk } : {}) };
}

/** `true` when the judgement could not see its input, which must never become an ACCEPT. */
function inputWasMissing(reason: GateReason | null): boolean {
  return reason === 'GATE_INPUT_MISSING';
}

/** Map an evidence judgement (and the risk band) to the final decision for one iteration. */
export function verdictForEvidence(
  judgement: EvidenceGateJudgement,
  risk: RiskAssessment | null | undefined,
): EvidenceVerdict {
  if (inputWasMissing(judgement.reason)) return { decision: 'QUARANTINE', reason: 'GATE_INPUT_MISSING' };
  if (!judgement.all_public_passed) return { decision: 'REJECT', reason: 'PUBLIC_TEST_FAILURE' };
  if (!judgement.all_private_within_tolerance) return { decision: 'REJECT', reason: 'HIDDEN_REGRESSION', private_regressions: true };
  if (!judgement.objective_valid) return { decision: 'QUARANTINE', reason: 'OBJECTIVE_SCORE_INVALID' };
  if (judgement.comparison === null) return { decision: 'QUARANTINE', reason: 'OBJECTIVE_SCORE_INVALID' };
  if (!judgement.comparison.meets_min_delta) {
    return {
      decision: 'REJECT',
      reason: 'NO_PRACTICAL_IMPROVEMENT',
      improvement: judgement.comparison.improvement,
      min_delta: judgement.comparison.min_delta,
    };
  }
  if (!risk) return { decision: 'QUARANTINE', reason: 'RISK_ASSESSMENT_MISSING' };
  const verdict = verdictForRisk(risk.band, risk);
  return { ...verdict, improvement: judgement.comparison.improvement };
}
