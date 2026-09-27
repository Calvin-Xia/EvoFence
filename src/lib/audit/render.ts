/**
 * Rendering helpers for the audit view: the 200 KiB diff cap and the human-readable form.
 *
 * Ported from `src/lib/audit.js:1-18` (cap) and `:329-...` (format). `spec-f1` locks the exact
 * truncation banner (`[diff truncated at 204800 bytes;`) and the trailing
 * `[... diff truncated ...]` marker, so both the constant and the wording are contract.
 */

import type { AuditObjective, GenerationDiff } from '../../types/report.js';

/** Unified-diff byte cap. `spec-f1` asserts the literal 204800 in the banner. */
export const DIFF_CAP_BYTES = 200 * 1024;

/**
 * Truncates a diff to at most {@link DIFF_CAP_BYTES} utf8 bytes on a code-point boundary, so
 * the result never splits a surrogate pair. Returns whether truncation happened.
 */
export function capDiff(text: string): { diff: string; diff_truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= DIFF_CAP_BYTES) return { diff: text, diff_truncated: false };
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + size > DIFF_CAP_BYTES) break;
    bytes += size;
    index += width;
  }
  return { diff: text.slice(0, index), diff_truncated: true };
}

/** One line of objective context; `null`/non-finite values render as `n/a`. */
function objectiveDelta(objective: AuditObjective | null): string {
  if (!objective) return 'objective delta unknown (not recorded in the ledger)';
  const { improvement, score } = objective;
  const improvementText = improvement !== null && Number.isFinite(improvement)
    ? (improvement > 0 ? `+${improvement}` : `${improvement}`)
    : 'n/a';
  const scoreText = score !== null && Number.isFinite(score) ? `${score}` : 'n/a';
  return `objective delta ${improvementText} (${objective.metric ?? 'unknown'} ${objective.direction ?? 'unknown'} score ${scoreText})`;
}

/**
 * Renders the audit view: header, optional diff-hash mismatch warning, changed paths, the
 * public evidence checks, the truncation banner, then the diff itself. The evidence OUTPUT is
 * never rendered — only the three-field check summaries (`docs/refactor-inventory.md` §10.3
 * item 15, locked by a `spec-f1` sentinel-string case).
 */
export function formatGenerationDiff(report: GenerationDiff): string {
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
