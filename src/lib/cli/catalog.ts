/**
 * The command-surface catalog: every subcommand, its flags, its exit codes and its smoke
 * invocation (node `l2_cli`, ADR-0003).
 *
 * THIS FILE IS THE MANIFEST (DoD 1). It is deliberately data-only — no handler logic, no I/O —
 * so it can be reviewed, diffed and consumed by docs, integration adapters and the smoke test.
 * `src/lib/cli/commands.ts` exposes the lookup/help API over it; `src/cli.ts` is the entry.
 *
 * GROUPING (ADR-0003 keeps the 0.3.0 group skeleton, with the flag/JSON/exit conventions
 * unified inside it): `init`, `run`, `proposal`, `evidence`, `gate`, `ledger`, `diff`,
 * `rollback`, `experiment`, `report`, `budget`, `status`. Groups with more than one operation carry an
 * explicit action (`proposal inspect`, `evidence run`, `ledger show|verify|recent|export`,
 * `experiment run|export`).
 */
import type { CommandSpec, FlagSpec, SmokeFixture, SmokeSpec } from './spec.js';

/**
 * Fixture data the smoke invocations refer to. `test/cli-surface.test.js` seeds repositories
 * from these very names, so the manifest and the fixture share one vocabulary.
 */
export const SMOKE = {
  /** Seeded `proposal.created` id in the `ledger` fixture. */
  proposalId: 'prop-cli-smoke',
  /** Seeded run id in the `ledger` fixture. */
  runId: 'run-cli-smoke',
  /** Seeded accepted generation in the `ledger` fixture (its sha is a real commit). */
  generationId: 'g-run-cli-smoke-i01',
  /** Goal file the `agentless` fixture provides for `run` / `experiment run`. */
  goalFile: 'goal.md',
  /** Experiment manifest inside the `agentless` fixture. */
  experimentFile: 'experiment.yaml',
  /** Text-mode output paths, kept distinct so no two smoke runs collide on an existing file. */
  ledgerExport: 'export-ledger.json',
  experimentExport: 'export-experiment.json',
  reportFile: 'smoke-report.md',
  /** `--json` output paths used by the manifest's own `jsonSmoke` invocations. */
  ledgerExportJson: 'export-ledger-json.json',
  experimentExportJson: 'export-experiment-json.json',
  reportJsonFile: 'smoke-report.json',
  /**
   * Extra `--json` output paths owned by `JSON_WRITE_SMOKES`. They are kept distinct from the
   * `*Json` names above because `ledger/experiment export` refuse to overwrite (`wx`) and the two
   * tables run against the same fixture in one test process.
   */
  writeLedgerJson: 'write-ledger-json.json',
  writeExperimentJson: 'write-experiment-json.json',
  writeReportJson: 'write-report-json.json',
} as const;

/** `0` on success, `1` for every failure, with the command's own failure trigger appended. */
function exits(success: string, failure: string): readonly { code: number; when: string }[] {
  return [
    { code: 0, when: success },
    { code: 1, when: failure },
  ];
}

const JSON_FLAG: FlagSpec = { name: 'json', key: 'json', kind: 'boolean', description: 'Emit the machine-readable view instead of text.' };
const GOAL_FLAG: FlagSpec = { name: 'goal', key: 'goal', kind: 'value', required: true, description: 'Path to the goal file (required).' };
const ADAPTER_FLAG: FlagSpec = { name: 'adapter', key: 'adapter', kind: 'value', description: 'Agent adapter: codex (default), opencode, claude or pi.' };
const ITERATIONS_FLAG: FlagSpec = { name: 'iterations', key: 'iterations', kind: 'value', description: 'Iteration cap; must not exceed the contract budget.' };
const WALL_CLOCK_FLAG: FlagSpec = { name: 'max-wall-clock-ms', key: 'max_wall_clock_ms', kind: 'value', description: 'Wall-clock cap in milliseconds; must not exceed the contract budget.' };
const UNISOLATED_FLAG: FlagSpec = { name: 'allow-unisolated-agent', key: 'allow_unisolated_agent', kind: 'boolean', description: 'Required for opencode/claude/pi; CLI controls are not an OS sandbox.' };
const HOLDOUT_FLAG: FlagSpec = { name: 'allow-readable-holdout', key: 'allow_readable_holdout', kind: 'boolean', description: 'Required to run private checks when host read isolation is unavailable.' };
const BUNDLE_FLAG: FlagSpec = { name: 'bundle', key: 'bundle', kind: 'value', description: 'Read and verify an exported ledger bundle instead of the local SQLite ledger.' };
const REPORT_FORMAT_FLAG: FlagSpec = { name: 'format', key: 'format', kind: 'value', description: 'Report format: text (default), json, sarif or junit.' };
const FIX_FLAG: FlagSpec = { name: 'fix', key: 'fix', kind: 'boolean', description: 'Apply safe, idempotent doctor remediations and rerun the checks.' };

const LEDGER = 'ledger' as const;
const AGENTLESS = 'agentless' as const;

/** `ledger` fixture: a healthy, fully consistent seeded ledger. */
function inLedger(args: readonly string[], code: number, note?: string): SmokeSpec {
  return { args, code, fixture: LEDGER, ...(note === undefined ? {} : { note }) };
}

/** `agentless` fixture: a git repo whose contract cannot pass its own baseline. */
function agentless(args: readonly string[], code: number, note: string): SmokeSpec {
  return { args, code, fixture: AGENTLESS, note };
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'init',
    group: 'init',
    summary: 'Create the .evofence skeleton (contract, config, prompts, schemas, ledger).',
    usage: 'init [--json]',
    positionals: [],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the skeleton exists (created now or already present)', 'a control-plane file is a symlink/non-regular, or the repository cannot be resolved'),
    smoke: inLedger(['init'], 0),
    jsonSmoke: inLedger(['init', '--json'], 0),
  },
  {
    name: 'run',
    group: 'run',
    summary: 'Run the evolution loop against one goal.',
    usage: 'run --goal <file> [--adapter <name>] [--iterations N] [--max-wall-clock-ms N] [--allow-unisolated-agent] [--allow-readable-holdout] [--json]',
    positionals: [],
    flags: [GOAL_FLAG, ADAPTER_FLAG, ITERATIONS_FLAG, WALL_CLOCK_FLAG, UNISOLATED_FLAG, HOLDOUT_FLAG, JSON_FLAG],
    json: 'flag',
    exits: exits(
      'the run finished with ACCEPTED or PLATEAU',
      'usage error, thrown domain error, or a run that ended BASELINE_UNHEALTHY/ESCALATE/QUARANTINE/RESOURCE_EXHAUSTED/HARNESS_ERROR',
    ),
    smoke: inLedger(['run'], 1, 'no --goal: usage error'),
    jsonSmoke: agentless(['run', '--json', '--goal', SMOKE.goalFile], 1, 'baseline cannot pass, so the run JSON view is printed on stdout and the exit code is 1'),
  },
  {
    name: 'proposal inspect',
    group: 'proposal',
    action: 'inspect',
    summary: 'Print the proposal payload recorded for a proposal id.',
    usage: 'proposal inspect <proposal-id> [--json]',
    positionals: [{ name: 'proposal-id', required: true }],
    flags: [JSON_FLAG],
    json: 'always',
    exits: exits('the proposal was found', 'usage error, or PROPOSAL_NOT_FOUND'),
    smoke: inLedger(['proposal', 'inspect', SMOKE.proposalId], 0),
    jsonSmoke: inLedger(['proposal', 'inspect', SMOKE.proposalId, '--json'], 0),
  },
  {
    name: 'evidence run',
    group: 'evidence',
    action: 'run',
    summary: 'Re-run the contract evidence commands against a candidate directory.',
    usage: 'evidence run <candidate-directory> [--json]',
    positionals: [{ name: 'candidate-directory', required: true }],
    flags: [JSON_FLAG],
    json: 'always',
    exits: exits('every public check passed', 'usage error, NO_EVIDENCE_CONFIGURED, or a failed/within-tolerance-exceeding check'),
    smoke: inLedger(['evidence', 'run', '.'], 0),
    jsonSmoke: inLedger(['evidence', 'run', '.', '--json'], 0),
  },
  {
    name: 'gate',
    group: 'gate',
    summary: 'Print the last gate decision recorded for a proposal id.',
    usage: 'gate <proposal-id> [--json]',
    positionals: [{ name: 'proposal-id', required: true }],
    flags: [JSON_FLAG],
    json: 'always',
    exits: exits('a decision was found', 'usage error, PROPOSAL_NOT_FOUND, or GATE_DECISION_NOT_FOUND'),
    smoke: inLedger(['gate', SMOKE.proposalId], 0),
    jsonSmoke: inLedger(['gate', SMOKE.proposalId, '--json'], 0),
  },
  {
    name: 'ledger show',
    group: 'ledger',
    action: 'show',
    summary: 'Print the raw ledger events (optionally for one run id).',
    usage: 'ledger show [run-id] [--json]',
    positionals: [{ name: 'run-id', required: false }],
    flags: [JSON_FLAG],
    json: 'always',
    exits: exits('the events were read', 'usage error, or the ledger cannot be opened/read'),
    smoke: inLedger(['ledger', 'show', SMOKE.runId], 0),
    jsonSmoke: inLedger(['ledger', 'show', SMOKE.runId, '--json'], 0),
  },
  {
    name: 'ledger verify',
    group: 'ledger',
    action: 'verify',
    summary: 'Verify the ledger hash chain. Referenced by the downstream DoD.',
    usage: 'ledger verify [--bundle <file>] [--json]',
    positionals: [],
    flags: [BUNDLE_FLAG, JSON_FLAG],
    json: 'always',
    exits: exits('the local ledger or bundle hash chain verified', 'usage error, input/ledger read failure, or the chain failed verification'),
    smoke: inLedger(['ledger', 'verify'], 0),
    jsonSmoke: inLedger(['ledger', 'verify', '--json'], 0),
  },
  {
    name: 'ledger recent',
    group: 'ledger',
    action: 'recent',
    summary: 'Print sanitized summaries of the most recent runs.',
    usage: 'ledger recent [limit] [--json]',
    positionals: [{ name: 'limit', required: false, description: '1..20, default 10.' }],
    flags: [JSON_FLAG],
    json: 'always',
    exits: exits('the summaries were read', 'usage error, INVALID_RUN_LIMIT, or the ledger cannot be read'),
    smoke: inLedger(['ledger', 'recent', '5'], 0),
    jsonSmoke: inLedger(['ledger', 'recent', '5', '--json'], 0),
  },
  {
    name: 'ledger export',
    group: 'ledger',
    action: 'export',
    summary: 'Write the full ledger export bundle to a new JSON file.',
    usage: 'ledger export [file] [--json]',
    positionals: [{ name: 'file', required: false, description: 'Defaults to .evofence/experiment-<date>.json.' }],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the bundle was written to a new file', 'usage error, EEXIST, or the ledger cannot be read'),
    smoke: inLedger(['ledger', 'export', SMOKE.ledgerExport], 0),
    jsonSmoke: inLedger(['ledger', 'export', SMOKE.ledgerExportJson, '--json'], 0),
  },
  {
    name: 'diff',
    group: 'diff',
    summary: 'Recompute and print the verified diff for one generation.',
    usage: 'diff <generation-id> [--json]',
    positionals: [{ name: 'generation-id', required: true }],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the generation diff was verified', 'usage error, GENERATION_NOT_FOUND, LEDGER_CORRUPT, or GIT_VERSION_UNSUPPORTED'),
    smoke: inLedger(['diff', SMOKE.generationId], 0),
    jsonSmoke: inLedger(['diff', SMOKE.generationId, '--json'], 0),
  },
  {
    name: 'rollback',
    group: 'rollback',
    summary: 'Point the active-generation ref at an earlier generation (never touches the working tree).',
    usage: 'rollback <generation-id> [--json]',
    positionals: [{ name: 'generation-id', required: true }],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the ref was moved', 'usage error, LEDGER_CORRUPT, or GENERATION_NOT_FOUND'),
    smoke: inLedger(['rollback', SMOKE.generationId], 0),
    jsonSmoke: inLedger(['rollback', SMOKE.generationId, '--json'], 0),
  },
  {
    name: 'experiment run',
    group: 'experiment',
    action: 'run',
    summary: 'Run an experiment manifest (goal_file + optional budget/adapter fields).',
    usage: 'experiment run <experiment.yaml> [--json]',
    positionals: [{ name: 'experiment.yaml', required: true }],
    flags: [JSON_FLAG],
    json: 'always',
    exits: exits('the run finished with ACCEPTED or PLATEAU', 'usage error, INVALID_EXPERIMENT, or a run that did not reach ACCEPTED/PLATEAU'),
    smoke: agentless(['experiment', 'run', SMOKE.experimentFile], 1, 'same agentless baseline as `run`; the JSON view is always printed'),
    jsonSmoke: agentless(['experiment', 'run', SMOKE.experimentFile, '--json'], 1, 'the always-on JSON view plus the flag'),
  },
  {
    name: 'experiment export',
    group: 'experiment',
    action: 'export',
    summary: 'Alias of `ledger export` with the experiment default filename.',
    usage: 'experiment export [file] [--json]',
    positionals: [{ name: 'file', required: false }],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the bundle was written to a new file', 'usage error, EEXIST, or the ledger cannot be read'),
    smoke: inLedger(['experiment', 'export', SMOKE.experimentExport], 0),
    jsonSmoke: inLedger(['experiment', 'export', SMOKE.experimentExportJson, '--json'], 0),
  },
  {
    name: 'report',
    group: 'report',
    summary: 'Print the cross-run evolution report as text, JSON, SARIF or JUnit.',
    usage: 'report [file] [--format <text|json|sarif|junit>] [--json]',
    positionals: [{ name: 'file', required: false, description: 'Write to this path instead of stdout.' }],
    flags: [REPORT_FORMAT_FLAG, JSON_FLAG],
    json: 'flag',
    exits: exits('the report was rendered/written; --format json is the JSON view, while SARIF and JUnit are interoperable report formats', 'usage error, unsupported report format, conflicting --json/--format flags, or PROTECTED_PATH when the output would overwrite control-plane state'),
    smoke: inLedger(['report', SMOKE.reportFile], 0),
    jsonSmoke: inLedger(['report', SMOKE.reportJsonFile, '--json'], 0, 'write-file form: stdout must be the {"written","bytes"} JSON envelope, not the text line'),
  },
  {
    name: 'budget',
    group: 'budget',
    summary: 'Read ledger usage and thresholds into a deterministic historical-mean forecast.',
    usage: 'budget [--json]',
    positionals: [],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the read-only budget forecast was rendered; remaining rounds use the historical mean and are not a prediction commitment', 'usage error, an unreadable/incompatible ledger, or a failed ledger integrity check'),
    smoke: inLedger(['budget'], 0),
    jsonSmoke: inLedger(['budget', '--json'], 0),
  },
  {
    name: 'status',
    group: 'status',
    summary: 'Print the operational overview. Referenced by the downstream DoD.',
    usage: 'status [--json]',
    positionals: [],
    flags: [JSON_FLAG],
    json: 'flag',
    exits: exits('the overview was printed', 'usage error, LEDGER_UNAVAILABLE, or an integrity check that failed'),
    smoke: inLedger(['status'], 0),
    jsonSmoke: inLedger(['status', '--json'], 0),
  },
  {
    name: 'doctor',
    group: 'doctor',
    summary: 'Run preflight checks, optionally applying safe idempotent fixes.',
    usage: 'doctor [--adapter <name>] [--fix] [--json]',
    positionals: [],
    flags: [ADAPTER_FLAG, FIX_FLAG, JSON_FLAG],
    json: 'flag',
    exits: exits('all checks are ok', 'usage error, or at least one check is refused'),
    smoke: inLedger(['doctor'], 0),
    jsonSmoke: inLedger(['doctor', '--json'], 0),
  },
];

/**
 * `--json` invocations that also WRITE a file. `CommandSpec` carries exactly one `jsonSmoke`, so a
 * command with two `--json` shapes (with and without the output path) can pin only one of them
 * there. Every row here is driven by `test/cli-surface.test.js`, which asserts the invocation's
 * stdout is a BARE JSON envelope (nothing else) and that the named file really exists.
 *
 * That makes this table the regression guard for the F8c gap: `report <file> --json` used to print
 * `Report written to <file>` on stdout. Adding a new write-file `--json` form without a row here
 * fails the test, because it also asserts the table covers exactly the commands with a `file`
 * positional.
 *
 * The envelope key holding the repo-relative output path is part of the contract and differs per
 * command: `report` -> `{"written": "<path>", "bytes": <n>}`; `ledger export` and
 * `experiment export` -> `{"exported": "<path>"}` (their pre-existing shape).
 */
export interface JsonWriteSmokeSpec {
  /** Canonical command name; must also exist in `COMMANDS`. */
  readonly command: string;
  readonly args: readonly string[];
  readonly fixture: SmokeFixture;
  /** Envelope key that must hold the repo-relative path of the written file. */
  readonly pathKey: string;
  /** The exact value that key must hold (equals the path given on the command line). */
  readonly path: string;
}

export const JSON_WRITE_SMOKES: readonly JsonWriteSmokeSpec[] = [
  {
    command: 'report',
    args: ['report', SMOKE.writeReportJson, '--json'],
    fixture: LEDGER,
    pathKey: 'written',
    path: SMOKE.writeReportJson,
  },
  {
    command: 'ledger export',
    args: ['ledger', 'export', SMOKE.writeLedgerJson, '--json'],
    fixture: LEDGER,
    pathKey: 'exported',
    path: SMOKE.writeLedgerJson,
  },
  {
    command: 'experiment export',
    args: ['experiment', 'export', SMOKE.writeExperimentJson, '--json'],
    fixture: LEDGER,
    pathKey: 'exported',
    path: SMOKE.writeExperimentJson,
  },
];
