import { EvoFenceError } from './errors.js';
import { sha256, stableStringify } from './fs.js';
import { assertGitVersionAtLeast, changedPathsBetween, diffHash, runGit } from './git.js';

const DIFF_CAP_BYTES = 200 * 1024;

function capDiff(text) {
  if (Buffer.byteLength(text, 'utf8') <= DIFF_CAP_BYTES) return { diff: text, diff_truncated: false };
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    const width = codePoint > 0xffff ? 2 : 1;
    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + size > DIFF_CAP_BYTES) break;
    bytes += size;
    index += width;
  }
  return { diff: text.slice(0, index), diff_truncated: true };
}

function latestEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function acceptedEvent(events, generationId) {
  return latestEvent(events, (event) => event.event_type === 'candidate.accepted' && event.payload?.generation_id === generationId);
}

function verifyProposalDigestClaim(event) {
  const claim = event.payload?.proposal_sha256;
  const proposal = event.payload?.proposal;
  if (typeof claim !== 'string' || !proposal || typeof proposal !== 'object') return;
  const computed = sha256(stableStringify(proposal));
  if (computed !== claim) {
    throw new EvoFenceError('LEDGER_CORRUPT', `proposal.created digest claim ${claim} does not match its proposal content (computed ${computed}).`);
  }
}

function proposalEventFor(events, accepted) {
  const digest = accepted.payload?.proposal_sha256;
  if (typeof digest === 'string') {
    const byDigest = events.filter((event) => event.event_type === 'proposal.created'
      && event.run_id === accepted.run_id && event.payload?.proposal_sha256 === digest);
    if (!byDigest.length) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted proposal_sha256 ${digest} matches no proposal.created event for run ${accepted.run_id}.`);
    }
    if (byDigest.length > 1) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted proposal_sha256 ${digest} matches ${byDigest.length} proposal.created events for run ${accepted.run_id}; the proposal link is ambiguous.`);
    }
    verifyProposalDigestClaim(byDigest[0]);
    return byDigest[0];
  }
  const byIteration = events.filter((event) => event.event_type === 'proposal.created'
    && event.run_id === accepted.run_id && event.payload?.iteration === accepted.payload?.iteration);
  if (byIteration.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted iteration ${accepted.payload?.iteration} matches ${byIteration.length} proposal.created events for run ${accepted.run_id}; the proposal link is ambiguous.`);
  }
  if (byIteration[0]) verifyProposalDigestClaim(byIteration[0]);
  return byIteration[0] ?? null;
}

function evidenceEventFor(events, accepted) {
  const candidates = events.filter((event) => event.event_type === 'evidence.candidate'
    && event.run_id === accepted.run_id && event.payload?.iteration === accepted.payload?.iteration);
  const artifact = accepted.payload?.evidence_artifact;
  if (typeof artifact === 'string') {
    const bound = candidates.filter((event) => event.payload?.evidence?.artifact === artifact);
    if (bound.length !== 1) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted evidence_artifact ${artifact} matches ${bound.length} evidence.candidate events for run ${accepted.run_id} iteration ${accepted.payload?.iteration}; expected exactly one.`);
    }
    return bound[0];
  }
  return candidates.at(-1) ?? null;
}

function runStartedEventFor(events, runId) {
  if (typeof runId !== 'string' || !runId) return null;
  return latestEvent(events, (event) => event.event_type === 'run.started' && event.run_id === runId);
}

const GENERATION_RECORD_KEYS = ['run_id', 'sha', 'parent_sha', 'created_at'];

function verifyGenerationMetadata(events, generation) {
  const recordEvents = events.filter((event) => event.event_type === 'generation.accepted'
    && event.payload?.generation_id === generation.generation_id);
  if (!recordEvents.length) {
    throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} has no hash-chained generation.accepted record.`);
  }
  if (recordEvents.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} has ${recordEvents.length} generation.accepted records; the association is ambiguous.`);
  }
  const record = recordEvents[0].payload;
  for (const key of GENERATION_RECORD_KEYS) {
    if (record[key] !== generation[key]) {
      throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} ${key} disagrees with its hash-chained generation.accepted record.`);
    }
  }
  const acceptedEvents = events.filter((event) => event.event_type === 'candidate.accepted'
    && event.payload?.generation_id === generation.generation_id);
  if (acceptedEvents.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `Generation ${generation.generation_id} has ${acceptedEvents.length} candidate.accepted events; the acceptance record is ambiguous.`);
  }
  for (const event of acceptedEvents) {
    if (event.run_id !== generation.run_id) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted evidence for generation ${generation.generation_id} is recorded under run ${event.run_id ?? 'null'} instead of ${generation.run_id ?? 'null'}.`);
    }
    if (event.payload.sha !== generation.sha || event.payload.parent_sha !== generation.parent_sha) {
      throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted evidence disagrees with generation ${generation.generation_id} metadata.`);
    }
  }
}

function verifyObjectiveEvidence(accepted, evidenceEvent, generationId) {
  if (!accepted || typeof accepted.payload?.objective_score !== 'number') return;
  const evidenceScore = evidenceEvent?.payload?.evidence?.objective?.score;
  if (evidenceScore !== accepted.payload.objective_score) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted objective_score ${accepted.payload.objective_score} disagrees with bound evidence score ${evidenceScore === undefined ? 'missing' : evidenceScore} for generation ${generationId}.`);
  }
}

function improvementBaselineScore(events, accepted) {
  const previous = latestEvent(events, (event) => event.event_type === 'candidate.accepted'
    && event.run_id === accepted.run_id && event.seq < accepted.seq);
  if (previous) {
    verifyObjectiveEvidence(previous, evidenceEventFor(events, previous), previous.payload?.generation_id ?? 'unknown');
    const score = previous.payload?.objective_score;
    return typeof score === 'number' ? score : null;
  }
  const baselines = events.filter((event) => event.event_type === 'evidence.baseline'
    && event.run_id === accepted.run_id && event.seq < accepted.seq);
  if (baselines.length > 1) {
    throw new EvoFenceError('LEDGER_CORRUPT', `${baselines.length} evidence.baseline events precede the acceptance of generation ${accepted.payload?.generation_id ?? 'unknown'}; the baseline is ambiguous.`);
  }
  if (!baselines.length) return null;
  const score = baselines[0].payload?.objective?.objective?.score ?? baselines[0].payload?.objective?.score;
  return typeof score === 'number' ? score : null;
}

function verifyImprovementEvidence(events, accepted, runStartedEvent, generationId) {
  if (!accepted) return;
  const improvement = accepted.payload?.improvement;
  if (typeof improvement !== 'number') return;
  const score = accepted.payload?.objective_score;
  const direction = runStartedEvent?.payload?.contract_snapshot?.objective?.direction;
  const baselineScore = improvementBaselineScore(events, accepted);
  if (typeof score !== 'number' || baselineScore === null || typeof direction !== 'string') {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted improvement ${improvement} for generation ${generationId} cannot be derived from ledger evidence.`);
  }
  const expected = direction === 'maximize' ? score - baselineScore : baselineScore - score;
  if (expected !== improvement) {
    throw new EvoFenceError('LEDGER_CORRUPT', `candidate.accepted improvement ${improvement} disagrees with ledger evidence (expected ${expected}) for generation ${generationId}.`);
  }
}

function auditObjective(accepted, proposalEvent, runStartedEvent) {
  if (!accepted) return null;
  const contractObjective = runStartedEvent?.payload?.contract_snapshot?.objective;
  if (!contractObjective || typeof contractObjective !== 'object') return null;
  const expectedEffect = proposalEvent?.payload?.proposal?.expected_effect;
  return {
    metric: typeof contractObjective.name === 'string'
      ? contractObjective.name
      : (typeof expectedEffect?.primary_metric === 'string' ? expectedEffect.primary_metric : null),
    direction: typeof contractObjective.direction === 'string' ? contractObjective.direction : null,
    score: accepted.payload?.objective_score ?? null,
    improvement: accepted.payload?.improvement ?? null,
  };
}

function auditEvidence(evidenceEvent) {
  const evidence = evidenceEvent?.payload?.evidence;
  if (!evidence || typeof evidence !== 'object') return null;
  const checks = (Array.isArray(evidence.public) ? evidence.public : []).map((item) => ({
    id: item?.id ?? null,
    kind: item?.kind ?? null,
    result: item?.result ?? null,
  }));
  return {
    all_public_passed: evidence.all_public_passed === true,
    all_private_within_tolerance: evidence.all_private_within_tolerance === true,
    checks,
  };
}

export async function generationDiff({ root, ledger, generationId }) {
  const integrity = ledger.verify();
  if (!integrity.valid) {
    throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
  }
  const generation = ledger.generation(generationId);
  if (!generation) throw new EvoFenceError('GENERATION_NOT_FOUND', `Generation not found: ${generationId}`);
  const events = ledger.events();
  const accepted = acceptedEvent(events, generationId);
  verifyGenerationMetadata(events, generation);
  const proposalEvent = accepted ? proposalEventFor(events, accepted) : null;
  const evidenceEvent = accepted ? evidenceEventFor(events, accepted) : null;
  verifyObjectiveEvidence(accepted, evidenceEvent, generationId);
  const runStartedEvent = runStartedEventFor(events, generation.run_id)
    ?? runStartedEventFor(events, accepted?.run_id ?? null);
  verifyImprovementEvidence(events, accepted, runStartedEvent, generationId);

  // Pin diff attributes to the generation's tree so a divergent primary checkout
  // (e.g. different .gitattributes) cannot skew the diff or its recorded hash.
  // GIT_ATTR_SOURCE needs Git 2.42+; on older Git it is silently ignored, so fail
  // clearly instead of silently rendering the diff under the primary checkout's attributes.
  await assertGitVersionAtLeast(root, 2, 42, 'attribute-pinned audit diffs');
  const attrEnv = { GIT_ATTR_SOURCE: generation.sha };
  const [changedPaths, diffText, computedDiffHash] = await Promise.all([
    changedPathsBetween(root, generation.parent_sha, generation.sha),
    runGit(root, ['diff', '--no-ext-diff', '--no-renames', generation.parent_sha, generation.sha], { maxOutputBytes: 50_000_000, env: attrEnv }),
    diffHash(root, generation.parent_sha, generation.sha, { env: attrEnv }),
  ]);
  const { diff, diff_truncated } = capDiff(diffText);
  const recordedDiffHash = typeof accepted?.payload?.diff_sha256 === 'string' ? accepted.payload.diff_sha256 : null;

  return {
    generation_id: generation.generation_id,
    run_id: generation.run_id ?? null,
    sha: generation.sha,
    parent_sha: generation.parent_sha,
    accepted: accepted !== null,
    diff_sha256: computedDiffHash,
    diff_sha256_recorded: recordedDiffHash,
    diff_sha256_matches: recordedDiffHash === null ? null : recordedDiffHash === computedDiffHash,
    changed_paths: [...changedPaths].sort(),
    diff,
    diff_truncated,
    objective: auditObjective(accepted, proposalEvent, runStartedEvent),
    evidence: auditEvidence(evidenceEvent),
    proposal_id: proposalEvent?.payload?.proposal_id ?? null,
    accepted_at: generation.created_at ?? null,
  };
}

function objectiveDelta(objective) {
  if (!objective) return 'objective delta unknown (not recorded in the ledger)';
  const improvement = Number.isFinite(objective.improvement) ? (objective.improvement > 0 ? `+${objective.improvement}` : `${objective.improvement}`) : 'n/a';
  const score = Number.isFinite(objective.score) ? `${objective.score}` : 'n/a';
  return `objective delta ${improvement} (${objective.metric ?? 'unknown'} ${objective.direction ?? 'unknown'} score ${score})`;
}

export function formatGenerationDiff(report) {
  const status = report.accepted === false
    ? 'not accepted (no candidate.accepted event in the ledger)'
    : objectiveDelta(report.objective);
  const lines = [`Generation ${report.generation_id} ${report.sha.slice(0, 12)} ${status}`];
  if (report.diff_sha256_matches === false) {
    lines.push(`[diff hash mismatch: the ledger records ${report.diff_sha256_recorded} but the git diff hashes to ${report.diff_sha256}]`);
  }
  lines.push(
    ...report.changed_paths,
    ...(report.evidence ? report.evidence.checks.map((check) => `${check.id} ${check.kind} ${check.result}`) : []),
    ...(report.diff_truncated
      ? [`[diff truncated at ${DIFF_CAP_BYTES} bytes; the unified diff below is incomplete]`]
      : []),
  );
  const tail = report.diff_truncated ? '\n[... diff truncated ...]' : '';
  return `${lines.join('\n')}\n${report.diff}${tail}`;
}
