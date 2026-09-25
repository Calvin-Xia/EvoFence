#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeRepository } from './lib/init.js';
import { loadContract, loadPrivateHoldout, parseYamlText } from './lib/contract.js';
import { Ledger, ledgerPath } from './lib/ledger.js';
import { collectEvidence } from './lib/evidence.js';
import { runEvolution } from './lib/runner.js';
import { repositoryRoot, setActiveGenerationRef } from './lib/git.js';
import { generationDiff, formatGenerationDiff } from './lib/audit.js';
import { EvoFenceError } from './lib/errors.js';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `EvoFence ${packageJson.version} — evidence-carrying evolution control plane

Usage:
  evofence init
  evofence run --adapter codex|opencode|claude|pi --goal <file> [--iterations N] [--max-wall-clock-ms N]
  evofence proposal inspect <proposal-id>
  evofence evidence run <candidate-directory>
  evofence gate <proposal-id>
  evofence ledger show [run-id]
  evofence ledger verify
  evofence ledger recent [limit]
  evofence ledger export [file]
  evofence rollback <generation-id>
  evofence diff <generation-id> [--json]
  evofence experiment run <experiment.yaml>
  evofence experiment export [file]

Options:
  --allow-unisolated-agent  Required for OpenCode, Claude Code, and Pi; CLI controls are not an OS sandbox.
  --allow-readable-holdout  Required to run private checks when host read isolation is unavailable.
  --json                    Print run results as JSON.
  --help                    Show this help.
`;

function parseOptions(args, booleanOptions = []) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (booleanOptions.includes(name)) {
      options[name.replaceAll('-', '_')] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new EvoFenceError('USAGE', `Option ${arg} requires a value.`);
    options[name.replaceAll('-', '_')] = value;
    index += 1;
  }
  return { options, positional };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printError(error) {
  const code = error.code ? `[${error.code}] ` : '';
  process.stderr.write(`${code}${error.message}\n`);
  if (error.details && process.env.EVOFENCE_DEBUG) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
}

function progress(event) {
  if (event.type === 'run.started') process.stdout.write(`Run ${event.run_id}: base ${event.base_sha.slice(0, 12)}, up to ${event.iterations} iteration(s).\n`);
  else if (event.type === 'candidate.proposal.start') process.stdout.write(`Iteration ${event.iteration}: asking ${event.adapter} for a proposal.\n`);
  else if (event.type === 'candidate.implementation.start') process.stdout.write(`Iteration ${event.iteration}: implementing the proposal.\n`);
  else if (event.type === 'candidate.accepted') process.stdout.write(`Iteration ${event.iteration}: ACCEPT ${event.generation_id} (+${event.improvement}).\n`);
  else if (event.check) process.stdout.write(`  Evidence: ${event.phase}/${event.check}\n`);
  else if (event.phase === 'private_regression') process.stdout.write(`  Evidence: ${event.phase} case ${event.case}\n`);
}

async function commandInit() {
  const result = await initializeRepository(process.cwd());
  process.stdout.write(result.existing ? `EvoFence is already initialized in ${result.root}\n` : `Initialized EvoFence in ${result.root}\nCreated: ${result.created.join(', ')}\n`);
  process.stdout.write('Review .evofence/contract.yaml and add a numeric objective plus at least one hard invariant before running agents.\n');
}

async function commandRun(args) {
  const { options, positional } = parseOptions(args, ['allow-unisolated-agent', 'allow-readable-holdout', 'json']);
  if (positional.length) throw new EvoFenceError('USAGE', `Unexpected run arguments: ${positional.join(' ')}`);
  if (!options.goal) throw new EvoFenceError('USAGE', 'run requires --goal <file>.');
  const goalPath = path.resolve(process.cwd(), options.goal);
  const goal = await readFile(goalPath, 'utf8');
  const result = await runEvolution({
    cwd: process.cwd(),
    goal,
    adapter: options.adapter ?? 'codex',
    iterations: options.iterations === undefined ? undefined : Number(options.iterations),
    maxWallClockMs: options.max_wall_clock_ms === undefined ? undefined : Number(options.max_wall_clock_ms),
    allowUnisolatedAgent: options.allow_unisolated_agent === true,
    allowReadableHoldout: options.allow_readable_holdout === true,
    onProgress: options.json ? undefined : progress,
  });
  if (options.json) printJson(result);
  else {
    process.stdout.write(`Run ${result.run_id} finished: ${result.status}.\n`);
    if (result.active_generation) process.stdout.write(`Active generation: ${result.active_generation.generation_id} (${result.active_generation.sha.slice(0, 12)}).\n`);
    if (result.failure) process.stdout.write(`Reason: ${JSON.stringify(result.failure)}\n`);
  }
  if (!['ACCEPTED', 'PLATEAU'].includes(result.status)) process.exitCode = 1;
}

async function commandProposal(args) {
  const [action, proposalId, ...rest] = args;
  if (action !== 'inspect' || !proposalId || rest.length) throw new EvoFenceError('USAGE', 'Use: evofence proposal inspect <proposal-id>');
  const root = await repositoryRoot(process.cwd());
  const ledger = new Ledger(ledgerPath(root));
  try {
    const event = ledger.events().find((item) => item.event_type === 'proposal.created' && item.payload.proposal_id === proposalId);
    if (!event) throw new EvoFenceError('PROPOSAL_NOT_FOUND', `Proposal not found: ${proposalId}`);
    printJson(event.payload.proposal);
  } finally { ledger.close(); }
}

async function commandEvidence(args) {
  const [action, directory, ...rest] = args;
  if (action !== 'run' || !directory || rest.length) throw new EvoFenceError('USAGE', 'Use: evofence evidence run <candidate-directory>');
  const root = await repositoryRoot(process.cwd());
  const candidate = path.resolve(process.cwd(), directory);
  const contract = await loadContract(root);
  if (!contract.hard_invariants.length && !contract.evidence.public_commands.length) {
    throw new EvoFenceError('NO_EVIDENCE_CONFIGURED', 'Add at least one hard invariant or public evidence command to .evofence/contract.yaml before running evidence.');
  }
  const holdout = await loadPrivateHoldout(root);
  const evidence = await collectEvidence({ root: candidate, artifactRoot: path.join(root, '.evofence'), contract, holdout, runId: `manual-${Date.now()}`, iteration: 0, phase: 'manual', onProgress: progress });
  printJson(evidence);
  if (!evidence.all_public_passed || !evidence.all_private_within_tolerance) process.exitCode = 1;
}

async function commandGate(args) {
  const [proposalId, ...rest] = args;
  if (!proposalId || rest.length) throw new EvoFenceError('USAGE', 'Use: evofence gate <proposal-id>');
  const root = await repositoryRoot(process.cwd());
  const ledger = new Ledger(ledgerPath(root));
  try {
    const events = ledger.events();
    const proposal = events.find((item) => item.event_type === 'proposal.created' && item.payload.proposal_id === proposalId);
    if (!proposal) throw new EvoFenceError('PROPOSAL_NOT_FOUND', `Proposal not found: ${proposalId}`);
    const decisions = events.filter((item) => item.event_type === 'gate.decision' && item.run_id === proposal.run_id && item.payload.iteration === proposal.payload.iteration);
    const last = decisions.at(-1);
    if (!last) throw new EvoFenceError('GATE_DECISION_NOT_FOUND', `No Gate decision recorded for ${proposalId}.`);
    printJson({ proposal_id: proposalId, ...last.payload });
  } finally { ledger.close(); }
}

async function commandLedger(args) {
  const [action, value, ...rest] = args;
  if (!action || rest.length) throw new EvoFenceError('USAGE', 'Use: evofence ledger show [run-id], verify, recent [limit], or export [file]');
  const root = await repositoryRoot(process.cwd());
  const ledger = new Ledger(ledgerPath(root), { readOnly: ['show', 'verify', 'recent'].includes(action) });
  try {
    if (action === 'show') printJson(ledger.events(value));
    else if (action === 'verify') {
      const result = ledger.verify();
      printJson(result);
      if (!result.valid) process.exitCode = 1;
    } else if (action === 'recent') {
      const limit = value === undefined ? 10 : Number(value);
      printJson(ledger.recentRuns(limit));
    } else if (action === 'export') {
      const output = path.resolve(process.cwd(), value ?? `.evofence/experiment-${new Date().toISOString().slice(0, 10)}.json`);
      await writeFile(output, `${JSON.stringify(ledger.export(), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(`Experiment evidence exported to ${path.relative(root, output).replaceAll('\\', '/')}\n`);
    } else throw new EvoFenceError('USAGE', `Unknown ledger action: ${action}`);
  } finally { ledger.close(); }
}

async function commandRollback(args) {
  const [generationId, ...rest] = args;
  if (!generationId || rest.length) throw new EvoFenceError('USAGE', 'Use: evofence rollback <generation-id>');
  const root = await repositoryRoot(process.cwd());
  const ledger = new Ledger(ledgerPath(root));
  try {
    const integrity = ledger.verify();
    if (!integrity.valid) throw new EvoFenceError('LEDGER_CORRUPT', `SQLite ledger hash chain failed at event ${integrity.sequence}.`);
    const generation = ledger.rollback(generationId);
    await setActiveGenerationRef(root, generation.sha);
    process.stdout.write(`Active generation rolled back to ${generationId} (${generation.sha.slice(0, 12)}). The primary working tree was not changed.\n`);
  } finally { ledger.close(); }
}

async function commandDiff(args) {
  const json = args.includes('--json');
  const unexpected = args.filter((arg) => arg.startsWith('--') && arg !== '--json');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (unexpected.length || positional.length !== 1) throw new EvoFenceError('USAGE', 'Use: evofence diff <generation-id> [--json]');
  const root = await repositoryRoot(process.cwd());
  const ledger = new Ledger(ledgerPath(root), { readOnly: true });
  try {
    const report = await generationDiff({ root, ledger, generationId: positional[0] });
    if (json) printJson(report);
    else {
      const text = formatGenerationDiff(report);
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    }
  } finally { ledger.close(); }
}

async function commandExperiment(args) {
  const [action, value, ...rest] = args;
  if (rest.length) throw new EvoFenceError('USAGE', 'Unexpected experiment arguments.');
  if (action === 'export') return commandLedger(['export', value].filter(Boolean));
  if (action !== 'run' || !value) throw new EvoFenceError('USAGE', 'Use: evofence experiment run <experiment.yaml> or experiment export [file]');
  const manifestPath = path.resolve(process.cwd(), value);
  const manifest = parseYamlText(await readFile(manifestPath, 'utf8'), manifestPath);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new EvoFenceError('INVALID_EXPERIMENT', 'Experiment manifest must be a YAML object.');
  if (typeof manifest.goal_file !== 'string') throw new EvoFenceError('INVALID_EXPERIMENT', 'Experiment manifest requires goal_file.');
  const goalPath = path.resolve(path.dirname(manifestPath), manifest.goal_file);
  const goal = await readFile(goalPath, 'utf8');
  const result = await runEvolution({
    cwd: process.cwd(), goal,
    adapter: manifest.adapter ?? 'codex',
    iterations: manifest.iterations,
    maxWallClockMs: manifest.max_wall_clock_ms,
    allowUnisolatedAgent: manifest.allow_unisolated_agent === true,
    allowReadableHoldout: manifest.allow_readable_holdout === true,
    onProgress: progress,
  });
  printJson(result);
  if (!['ACCEPTED', 'PLATEAU'].includes(result.status)) process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || args.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (command === 'init') await commandInit();
  else if (command === 'run') await commandRun(args);
  else if (command === 'proposal') await commandProposal(args);
  else if (command === 'evidence') await commandEvidence(args);
  else if (command === 'gate') await commandGate(args);
  else if (command === 'ledger') await commandLedger(args);
  else if (command === 'rollback') await commandRollback(args);
  else if (command === 'diff') await commandDiff(args);
  else if (command === 'experiment') await commandExperiment(args);
  else throw new EvoFenceError('USAGE', `Unknown command: ${command}\nRun evofence --help for usage.`);
}

try {
  await main();
} catch (error) {
  printError(error);
  process.exitCode = 1;
}
