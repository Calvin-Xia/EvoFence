/**
 * Audit domain entry point: the F1 acceptance oracle (`evofence diff <generation-id>`).
 *
 * This file is the R1-stable path of `src/lib/audit.js`. It keeps the 0.3.0 export surface —
 * `generationDiff`, `formatGenerationDiff` — and the exact fail-closed orchestration:
 * verify the chain, resolve the generation, validate the generation row, the gate decision,
 * the proposal link, the evidence link and the improvement arithmetic, and only then spend a
 * git call on the diff. Any failure throws before a single byte of evidence is presented
 * (§10.3 item 14, locked by `spec-f1`).
 *
 * The verification rules live in `src/lib/audit/links.ts`, the payload summaries in
 * `payload.ts`, and the rendering in `render.ts`; this file is the sequence that ties them
 * together (`docs/refactor-l2-protocol.md` R3).
 */

import type { GenerationRecord, LedgerEvent, LedgerVerification } from '../types/ledger.js';
import type { GenerationDiff } from '../types/report.js';
import { EvoFenceError } from './errors.js';
import { assertGitVersionAtLeast, changedPathsBetween, diffHash, runGit } from './git.js';
import { acceptedEvent, evidenceEventFor, proposalEventFor, runStartedEventFor, verifyAcceptanceEvidence, verifyGateDecision, verifyGenerationMetadata, verifyImprovementEvidence } from './audit/links.js';
import { auditEvidence, auditObjective, payloadOf } from './audit/payload.js';
import { capDiff } from './audit/render.js';

export { formatGenerationDiff } from './audit/render.js';

// `src/lib/git.js` is JavaScript with `checkJs: false`, so tsc infers `diffHash`'s optional
// `targetSha` parameter as the literal type `null` (its default value) even though the real
// function diffs an arbitrary target sha. Re-declare that call shape here rather than casting
// at the call site; the cast can be deleted once the exec domain ships `git.ts` types.
const computeDiffHash = diffHash as unknown as (
  root: string,
  parentSha: string,
  targetSha: string,
  options: { env: Record<string, string> },
) => Promise<string>;

/**
 * The only ledger surface the audit needs. Kept structural (as in 0.3.0, which duck-typed the
 * ledger) so the audit can run against any conforming reader without importing the `Ledger`
 * class — and so no dependency edge is created from audit into the ledger entry module.
 */
export interface AuditLedger {
  verify(): LedgerVerification;
  generation(generationId: string): GenerationRecord | null;
  events(): LedgerEvent[];
}

export interface GenerationDiffInput {
  root: string;
  ledger: AuditLedger;
  generationId: string;
}

/**
 * Builds the verified diff view for one generation, or throws (`LEDGER_CORRUPT`,
 * `GENERATION_NOT_FOUND`, `GIT_VERSION_UNSUPPORTED`). `diff_sha256_matches` is the single soft
 * signal: `null` when the ledger recorded no digest, otherwise a boolean reported inline.
 */
export async function generationDiff({ root, ledger, generationId }: GenerationDiffInput): Promise<GenerationDiff> {
  const integrity = ledger.verify();
  if (!integrity.valid) {
    throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
  }
  const generation = ledger.generation(generationId);
  if (!generation) throw new EvoFenceError('GENERATION_NOT_FOUND', `Generation not found: ${generationId}`);
  const events = ledger.events();
  const accepted = acceptedEvent(events, generationId);
  verifyGenerationMetadata(events, generation);
  verifyGateDecision(events, accepted);
  const proposalEvent = accepted ? proposalEventFor(events, accepted) : null;
  const evidenceEvent = accepted ? evidenceEventFor(events, accepted) : null;
  verifyAcceptanceEvidence(accepted, evidenceEvent, generationId);
  const runStartedEvent = runStartedEventFor(events, generation.run_id, accepted?.seq)
    ?? runStartedEventFor(events, accepted?.run_id ?? null, accepted?.seq);
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
    computeDiffHash(root, generation.parent_sha, generation.sha, { env: attrEnv }),
  ]);
  const { diff, diff_truncated } = capDiff(diffText);
  const recordedDiffHash = typeof payloadOf(accepted).diff_sha256 === 'string' ? payloadOf(accepted).diff_sha256 : null;

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
    proposal_id: payloadOf(proposalEvent).proposal_id ?? null,
    accepted_at: generation.created_at ?? null,
  };
}
