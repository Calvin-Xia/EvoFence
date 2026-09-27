/**
 * Exec domain · ledger payload helpers for the runner: the `adapter.finished` event, the
 * policy-drift digests and the helper-file predicate. Extracted verbatim from
 * `src/lib/runner.js`.
 */
import { sha256, stableStringify } from '../fs.js';
import { loadPrivateHoldout } from '../contract.js';
// The drift digests must be computed from the exact same validated documents the run path starts
// with, so this uses the v2 loaders too (R1 fix F1); a mixed pair would report policy drift on
// every iteration for a file nobody changed.
import { loadRequiredConfigDocumentSync, loadRequiredContractDocumentSync } from '../config/index.js';
import type { AdapterEventPayload, AdapterPhase, AdapterName, PolicyHashes } from '../../types/index.js';
import type { AdapterResultLike } from './types.js';

export function adapterEvent(result: AdapterResultLike, adapter: string, phase: string, iteration: number): AdapterEventPayload {
  return {
    adapter: adapter as AdapterName,
    model: result.model ?? null,
    phase: phase as AdapterPhase,
    iteration,
    exit_code: result.code ?? null,
    signal: result.signal ?? null,
    timed_out: result.timed_out === true,
    tree_termination_failed: result.tree_termination_failed === true,
    output_limited: result.output_limited === true,
    duration_ms: result.duration_ms ?? null,
    estimated_tokens: result.estimated_tokens ?? null,
    estimated_cost_usd: result.reported_usage?.cost_complete === true
      && result.reported_usage.cost_currency === 'USD'
      && Number.isFinite(result.reported_usage.reported_cost)
      && (result.reported_usage.reported_cost as number) >= 0
      ? result.reported_usage.reported_cost as number
      : null,
    reported_usage: result.reported_usage ?? null,
    ...(adapter === 'pi' ? { tool_strategy: result.tool_strategy ?? null } : {}),
    stdout_sha256: sha256(result.stdout ?? ''),
    stderr_sha256: sha256(result.stderr ?? ''),
  } as AdapterEventPayload;
}

/** The three policy digests compared at each drift checkpoint. */
export async function currentPolicyHashes(root: string): Promise<PolicyHashes> {
  const contract = loadRequiredContractDocumentSync(root);
  const holdout = await loadPrivateHoldout(root);
  const config = loadRequiredConfigDocumentSync(root);
  return {
    contract: sha256(stableStringify(contract)),
    holdout: sha256(stableStringify(holdout)),
    config: sha256(stableStringify(config)),
  };
}

/**
 * Controller helper files that never count as candidate changes. This is NOT a general path
 * utility: it only matches `.evofence-task.md` and `.evofence-out/**`.
 */
export function helperPath(filename: string): boolean {
  return filename === '.evofence-task.md' || filename === '.evofence-out' || filename.startsWith('.evofence-out/');
}
