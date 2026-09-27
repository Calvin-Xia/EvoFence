/**
 * `experiment run <experiment.yaml>` and `experiment export [file]`.
 *
 * DOMAIN: CLI handler (node `l2_cli`). `run` parses the manifest (0.3.0 semantics preserved
 * verbatim, including passing the raw YAML values through so the exec domain keeps owning budget
 * validation) and always prints the run JSON view. `export` is an alias of `ledger export` with
 * the experiment default filename (0.3.0 delegated exactly that way).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterName } from '../../../types/index.js';
import { parseYamlText } from '../../contract.js';
import { EvoFenceError } from '../../errors.js';
import { runEvolution } from '../../runner.js';
import { jsonDocument } from '../output.js';
import { exportLedger } from './ledger.js';
import { positional, type CommandContext } from './context.js';

export async function commandExperimentRun(context: CommandContext): Promise<number> {
  const manifestPath = path.resolve(context.cwd, positional(context, 0) as string);
  const manifest = parseYamlText(await readFile(manifestPath, 'utf8'), manifestPath);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new EvoFenceError('INVALID_EXPERIMENT', 'Experiment manifest must be a YAML object.');
  }
  if (typeof manifest.goal_file !== 'string') throw new EvoFenceError('INVALID_EXPERIMENT', 'Experiment manifest requires goal_file.');

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
