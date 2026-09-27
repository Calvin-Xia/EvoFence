/**
 * `experiment run <experiment.yaml>` and `experiment export [file]`.
 *
 * DOMAIN: CLI handler (node `l2_cli`). `run` validates the manifest through the v2 config
 * domain (unknown keys are rejected, so a mistyped `adaptor:` can no longer be silently dropped
 * and fall back to Codex) and always prints the run JSON view. `export` is an alias of
 * `ledger export` with the experiment default filename (0.3.0 delegated exactly that way).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterName, ExperimentManifest } from '../../../types/index.js';
import { assertValidReport, normalizedDocument, parsePolicyYaml, validateDocument } from '../../config/index.js';
import { runEvolution } from '../../runner.js';
import { jsonDocument } from '../output.js';
import { exportLedger } from './ledger.js';
import { positional, type CommandContext } from './context.js';

export async function commandExperimentRun(context: CommandContext): Promise<number> {
  const manifestPath = path.resolve(context.cwd, positional(context, 0) as string);
  const parsed = parsePolicyYaml(await readFile(manifestPath, 'utf8'), manifestPath);
  const report = validateDocument('experiment', parsed, manifestPath);
  assertValidReport(report);
  const manifest = normalizedDocument('experiment', report.value) as unknown as ExperimentManifest;

  const goalPath = path.resolve(path.dirname(manifestPath), manifest.goal_file);
  const goal = await readFile(goalPath, 'utf8');
  const result = await runEvolution({
    cwd: context.cwd,
    goal,
    adapter: (manifest.adapter ?? 'codex') as AdapterName,
    iterations: manifest.iterations as number | undefined,
    maxWallClockMs: manifest.max_wall_clock_ms as number | undefined,
    allowUnisolatedAgent: manifest.allow_unisolated_agent === true,
    allowReadableHoldout: manifest.allow_readable_holdout === true,
  });
  context.stdout(jsonDocument(result));
  return ['ACCEPTED', 'PLATEAU'].includes(result.status) ? 0 : 1;
}

export async function commandExperimentExport(context: CommandContext): Promise<number> {
  return exportLedger(context, positional(context, 0));
}
