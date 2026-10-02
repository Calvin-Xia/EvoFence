import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import { immutable } from '../assets/identity.js';
import { utf8Bytes } from './trace.js';
import type { CandidateDraft, CandidateSpec, Experience, GenerationAccounting, ProposalPorts, ProposalResult } from './types.js';

function text(value: unknown, experience: Experience): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= experience.limits.maxTextChars;
}
/** Model/user draft boundary. Provenance is resolved against extracted events, never model assertions. */
export function bindDrafts(
  input: unknown, experience: Experience, generation: GenerationAccounting, ports: Pick<ProposalPorts, 'digest'>,
): ProposalResult<readonly CandidateSpec[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > experience.limits.maxCandidates) {
    return storeFail('EFK_SCHEMA_INVALID', 'candidate count must be nonempty and bounded');
  }
  const candidates: CandidateSpec[] = [];
  const used = new Set<string>();
  for (const value of input) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 7 ||
        !['patternId', 'category', 'hypothesis', 'conditions', 'support', 'counterexamples', 'content'].every(key => Object.hasOwn(value, key))) {
      return storeFail('EFK_SCHEMA_INVALID', 'invalid candidate draft shape');
    }
    const draft = value as CandidateDraft;
    const pattern = experience.patterns.find(p => p.patternId === draft.patternId);
    if (pattern === undefined || used.has(draft.patternId)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'candidate pattern is absent or duplicated');
    used.add(draft.patternId);
    if (!['graph-template', 'strategy', 'experience', 'skill', 'tool'].includes(draft.category) ||
        draft.hypothesis === null || typeof draft.hypothesis !== 'object' || Object.keys(draft.hypothesis).length !== 3 ||
        !['intervention', 'expectedImprovement', 'measurement'].every(key => text(draft.hypothesis[key as keyof typeof draft.hypothesis], experience)) ||
        !text(draft.content, experience) || !Array.isArray(draft.conditions) || draft.conditions.length < 1 ||
        draft.conditions.length > 16 || !draft.conditions.every(c => text(c, experience)) ||
        !Array.isArray(draft.support) || draft.support.length === 0 || !Array.isArray(draft.counterexamples) || draft.counterexamples.length === 0) {
      return storeFail('EFK_SCHEMA_INVALID', 'candidate needs a bounded hypothesis, conditions, support and observed counterexamples');
    }
    if (draft.support.length + draft.counterexamples.length > experience.limits.maxEvents) return storeFail('EFK_SCHEMA_INVALID', 'candidate event bound exceeded');
    for (const link of draft.support) {
      if (!pattern.successes.some(actual => canonical(actual) === canonical(link))) {
        return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'support is not a real success event in this scoped pattern');
      }
    }
    for (const counter of draft.counterexamples) {
      if (counter === null || typeof counter !== 'object' || Object.keys(counter).length !== 2 ||
          !text(counter.limitation, experience) || !pattern.failures.some(actual => canonical(actual) === canonical(counter.event))) {
        return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'counterexample is not a real failure event in this scoped pattern');
      }
    }
    const linked = [...draft.support, ...draft.counterexamples.map(c => c.event)];
    if (new Set(linked.map(canonical)).size !== linked.length) return storeFail('EFK_SCHEMA_INVALID', 'candidate events must be unique');
    const sourceTraces = experience.traces.filter(t => linked.some(l => l.traceId === t.ref.id)).map(t => t.ref);
    const material = { ...draft, revision: 1 as const, qualification: 'staged' as const, claim: 'conditional-hypothesis' as const,
      scope: pattern.scope, sourceTraces, experienceDigest: experience.digest, limits: experience.limits, generation };
    const candidate: CandidateSpec = { ...material, candidateId: ports.digest.digest(canonical(material)) };
    if (utf8Bytes(canonical(candidate)) > experience.limits.maxCandidateBytes) return storeFail('EFK_SCHEMA_INVALID', 'candidate byte limit exceeded');
    candidates.push(candidate);
  }
  return storeOk(immutable(candidates));
}

/** Zero-provider baseline: paired observations suggest a testable intervention, never a proven rule. */
export function proposeDeterministically(experience: Experience, ports: Pick<ProposalPorts, 'digest'>): ProposalResult<readonly CandidateSpec[]> {
  const paired = experience.patterns.filter(p => p.successes.length > 0 && p.failures.length > 0).slice(0, experience.limits.maxCandidates);
  if (paired.length === 0) return storeFail('EFK_CAPABILITY_EVIDENCE_INSUFFICIENT', 'no scoped pattern has both success and an observed counterexample');
  const drafts: CandidateDraft[] = paired.map(pattern => ({ patternId: pattern.patternId, category: 'experience',
    hypothesis: { intervention: `Before reusing ${pattern.facet} experience, verify the current scoped evidence and recovery prerequisites.`,
      expectedImprovement: 'Fewer failed or unconfirmed coding-agent attempts within the pinned project/host/model/task scope.',
      measurement: 'Compare completion, retries and total resource usage on fresh tasks under matched budgets; benefit remains unproved.' },
    conditions: ['Apply only in the exact source project, host, model and task scope.',
      'A successful observation does not establish universal reliability or causal improvement.'],
    support: [pattern.successes[0]], counterexamples: [{ event: pattern.failures[0],
      limitation: `An observed ${pattern.facet} failure limits this hypothesis; validate current prerequisites before reuse.` }],
    content: `Stage a ${pattern.facet} prerequisite check and compare its effect before qualifying this experience.` }));
  return bindDrafts(drafts, experience, { method: 'deterministic', requests: 0, estimatedUsdMicros: 0, usage: [] }, ports);
}
