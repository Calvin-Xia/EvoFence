import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { writeProjectCandidate } from '../assets/index.js';
import type { CandidateArea } from '../assets/index.js';
import { bindDrafts } from './candidate.js';
import { collectGeneration } from './generation.js';
import { extractExperience } from './trace.js';
import type { CandidateDraft, CandidateSpec, Experience, GenerationCollector, GenerationPlan, ProposalPorts, ProposalResult } from './types.js';

function draftOf(candidate: CandidateSpec): CandidateDraft {
  const { patternId, category, hypothesis, conditions, support, counterexamples, content } = candidate;
  return { patternId, category, hypothesis, conditions, support, counterexamples, content };
}
/** Re-read exact sources at cp3/staging time; the extraction snapshot cannot substitute for current evidence. */
export function verifyCandidates(
  candidates: readonly CandidateSpec[], experience: Experience, at: number, ports: ProposalPorts,
  model?: { readonly plan: GenerationPlan; readonly collector: GenerationCollector; readonly sessionId: string; readonly effectId: string },
): ProposalResult<readonly CandidateSpec[]> {
  const refreshed = extractExperience(experience.traces.map(({ ref, expectation, scope, whyVisible, grade }) =>
    ({ ref, expectation, scope, whyVisible, grade })), experience.limits, at, ports);
  if (!refreshed.ok) return refreshed;
  if (refreshed.value.digest !== experience.digest) return storeFail('EFK_SOURCE_PIN_DRIFT', 'source experience changed before staging');
  let checked: ProposalResult<readonly CandidateSpec[]>;
  if (model !== undefined) checked = collectGeneration(refreshed.value, model.plan, model.sessionId, model.effectId, at, model.collector);
  else {
    if (candidates.some(c => c.generation.method !== 'deterministic')) return storeFail('EFK_USAGE_INCOMPLETE', 'host-generated staging requires its journal-derived accounting');
    checked = bindDrafts(candidates.map(draftOf), refreshed.value,
      { method: 'deterministic', requests: 0, estimatedUsdMicros: 0, usage: [] }, ports);
  }
  if (!checked.ok) return checked;
  const selected = checked.value.filter(c => candidates.some(input => input.candidateId === c.candidateId));
  if (canonical(selected) !== canonical(candidates)) return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'candidate content, provenance or accounting changed');
  return storeOk(selected);
}
/** Exclusive project staging only. No registry transition, control-plane write, promotion or activation. */
export async function stageCandidate(
  candidate: CandidateSpec, experience: Experience, area: CandidateArea, at: number, ports: ProposalPorts,
  model?: Parameters<typeof verifyCandidates>[4],
): Promise<ProposalResult<string>> {
  const verified = verifyCandidates([candidate], experience, at, ports, model); if (!verified.ok) return verified;
  // The filename is derived from a digest, never a model-supplied path.
  const filename = `${candidate.candidateId.replace(':', '-')}.json`;
  const written = await writeProjectCandidate(area, filename, canonical(candidate));
  return written.ok ? storeOk(written.value) : written;
}
