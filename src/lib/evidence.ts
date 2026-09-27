/**
 * Gate domain entry — R1 path: `src/lib/evidence.js` -> `src/lib/evidence.ts`.
 *
 * This file is now only the evidence *collector*: it executes the contract's commands, hashes
 * what they printed and persists the artifact. Every judgement drawn from what it collects
 * (pass/fail, private tolerance, objective validity, the end-of-iteration verdict) lives in the
 * pure gate modules `src/lib/gate/evidence.ts` and `src/lib/gate/verdict.ts` and is imported from
 * there, so the decision surface can be tested without running a process.
 *
 * `collectEvidence` keeps its 0.3.0 name, arguments and return shape (R2). Its one cross-domain
 * import is `./process.js` (exec domain): running trusted commands is the collector's job and the
 * exec-domain caller passes no injected runner, so the dependency cannot move without an L2 R2
 * break. It is reported as a known domain edge, not hidden.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finalNumericLine, runTrustedCommand } from './process.js';
import { sha256 } from './fs.js';
import { EvoFenceError } from './errors.js';
import { allCasesPassed, casePassed, isValidObjectiveScore, withinTolerance } from './gate/evidence.js';
// R1 fix F2: the single source of truth for the two declared contract code defaults.
// `src/lib/config/schema.js` is data-only (it imports nothing but the type contract), so this
// does not drag the config barrel's YAML/fs IO into the evidence collector.
import { CONTRACT_DEFAULTS } from './config/schema.js';
import type { EvidencePhase, TimedProcessResult, TrustedCommandResult } from '../types/exec.js';
import type { EvoFenceContract, PrivateRegressionConfig } from '../types/config.js';
import type { EvidenceBundle, EvidenceCaseSummary, EvidenceCheckSummary, ObjectiveEvidence, PrivateEvidenceCase } from '../types/evidence.js';

export interface CollectEvidenceOptions {
  /** Candidate checkout the commands run in. */
  root: string;
  /** Where `artifacts/<runId>/` is written; defaults to `root`. */
  artifactRoot?: string;
  contract: EvoFenceContract;
  holdout?: PrivateRegressionConfig[];
  runId: string;
  iteration?: number;
  deadlineAt?: number;
  phase?: EvidencePhase;
  onProgress?: (progress: Record<string, unknown>) => void;
}

type ExecutedCommand = TrustedCommandResult & TimedProcessResult;

/**
 * `runTrustedCommand` really accepts `cwd`, but the signature inferred from the still-JS
 * `src/lib/process.js` drops it (only `env`/`timeoutMs`/`maxOutputBytes` surface). The exec domain
 * owns that file during L2, so the boundary is bridged here instead of editing it.
 */
type TrustedCommandOptions = { cwd: string; timeoutMs: number; maxOutputBytes: number; env: Record<string, unknown> };
const runCommand = runTrustedCommand as unknown as (command: string, options: TrustedCommandOptions) => Promise<ExecutedCommand>;

/** A private holdout case entry: the summary plus its 1-based index. */
type PrivateCaseEntry = EvidenceCaseSummary & { case: number };

function summary(
  command: string,
  result: ExecutedCommand,
  { hidden = false, score = undefined }: { hidden?: boolean; score?: number | null } = {},
): EvidenceCaseSummary {
  return {
    command_sha256: sha256(command),
    passed: casePassed(result),
    result: result.timed_out ? 'TIMEOUT' : result.output_limited ? 'OUTPUT_LIMIT' : result.code === 0 ? 'PASS' : 'FAIL',
    exit_code: result.code,
    duration_ms: result.duration_ms,
    stdout_sha256: sha256(result.stdout),
    stderr_sha256: sha256(result.stderr),
    stdout_bytes: result.stdout_bytes,
    stderr_bytes: result.stderr_bytes,
    hidden,
    ...(score === undefined ? {} : { score }),
  };
}

async function execute(command: string, options: TrustedCommandOptions): Promise<ExecutedCommand> {
  const started = Date.now();
  const result = await runCommand(command, options);
  result.duration_ms = Date.now() - started;
  return result;
}

function boundedTimeout(contract: EvoFenceContract, deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new EvoFenceError('RESOURCE_EXHAUSTED', 'The run wall-clock budget has expired.');
  // R1 fix F2. `validateContract` only range-checks `per_command_timeout_ms ?? 120000`; it never
  // writes the default back onto the document, so an omitted key arrives as `undefined` and
  // `Math.min(undefined, remaining)` is `NaN`. Node coerces `setTimeout(NaN)` to a 1 ms timer,
  // which killed every evidence command that omitted the key. Apply the declared default from
  // its single source of truth (`CONTRACT_DEFAULTS`) instead of re-hard-coding it here.
  const perCommandTimeoutMs = contract.evidence.per_command_timeout_ms ?? CONTRACT_DEFAULTS['evidence.per_command_timeout_ms'];
  return Math.max(1, Math.min(perCommandTimeoutMs, remaining));
}

/** Run the contract's hard invariants, public commands, private holdout and objective, in order. */
export async function collectEvidence({
  root,
  artifactRoot,
  contract,
  holdout = [],
  runId,
  iteration = 0,
  deadlineAt = Infinity,
  phase = 'candidate',
  onProgress = () => {},
}: CollectEvidenceOptions): Promise<EvidenceBundle> {
  const startedAt = new Date();
  const results: EvidenceCheckSummary[] = [];
  // Same omitted-key shape as `boundedTimeout` (R1 fix F2): an absent `max_output_bytes` must
  // fall back to the declared default, not to `NaN` at the process-output guard.
  const maxOutputBytes = contract.evidence.max_output_bytes ?? CONTRACT_DEFAULTS['evidence.max_output_bytes'];
  const env = {
    EVOFENCE_PHASE: phase,
    EVOFENCE_RUN_ID: runId,
    EVOFENCE_ITERATION: iteration,
    EVOFENCE_CANDIDATE_DIR: root,
  };
  const checks = [
    ...contract.hard_invariants.map((item) => ({ id: item.id, command: item.command, kind: 'hard_invariant' as const })),
    ...contract.evidence.public_commands.map((command, index) => ({ id: `public-${index + 1}`, command, kind: 'public_check' as const })),
  ];
  for (const check of checks) {
    onProgress({ phase, check: check.id });
    const result = await execute(check.command, { cwd: root, timeoutMs: boundedTimeout(contract, deadlineAt), maxOutputBytes, env });
    results.push({ id: check.id, kind: check.kind, ...summary(check.command, result), command: check.command });
  }

  const privateResults: PrivateCaseEntry[] = [];
  for (let index = 0; index < holdout.length; index += 1) {
    const regression = holdout[index];
    onProgress({ phase: 'private_regression', case: index + 1 });
    const result = await execute(regression.command, { cwd: root, timeoutMs: boundedTimeout(contract, deadlineAt), maxOutputBytes, env });
    privateResults.push({ case: index + 1, ...summary(regression.command, result, { hidden: true }) });
  }

  let objective: ObjectiveEvidence | null = null;
  if (contract.objective.command.trim()) {
    onProgress({ phase, check: 'objective' });
    const result = await execute(contract.objective.command, { cwd: root, timeoutMs: boundedTimeout(contract, deadlineAt), maxOutputBytes, env });
    const score = casePassed(result) ? finalNumericLine(result.stdout) : null;
    objective = { ...summary(contract.objective.command, result, { score }), configured: true, valid_score: isValidObjectiveScore(score) };
  }

  const evidence: EvidenceBundle = {
    schema_version: 1,
    run_id: runId,
    iteration,
    phase,
    candidate_sha: null,
    started_at: startedAt.toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    public: results,
    private: {
      total: privateResults.length,
      passed: privateResults.filter((item) => item.passed).length,
      failed: privateResults.filter((item) => !item.passed).length,
      cases: privateResults.map(({ case: caseNumber, result, exit_code, passed, duration_ms }) => ({ case: caseNumber, result, exit_code, passed, duration_ms } as PrivateEvidenceCase)),
    },
    objective,
    all_public_passed: allCasesPassed(results),
    all_private_within_tolerance: withinTolerance(privateResults.filter((item) => !item.passed).length, contract.acceptance.hidden_regression_tolerance),
  };
  const evidenceDirectory = path.join(artifactRoot ?? root, 'artifacts', runId);
  const filename = path.join(evidenceDirectory, `${phase}-${iteration}-${Date.now()}.json`);
  await mkdir(evidenceDirectory, { recursive: true });
  evidence.artifact = `.evofence/artifacts/${runId}/${path.basename(filename)}`;
  const artifactText = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(filename, artifactText, { flag: 'wx', mode: 0o600 });
  evidence.artifact_sha256 = sha256(artifactText);
  return evidence;
}
