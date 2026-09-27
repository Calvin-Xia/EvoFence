/**
 * `evofence run` — drive the evolution loop for one goal file.
 *
 * DOMAIN: CLI handler (node `l2_cli`). The handler only translates flags into
 * `RunEvolutionOptions` and renders the outcome; every gate, budget and isolation decision stays
 * inside the exec domain (DoD 5). Exit code: `0` for ACCEPTED/PLATEAU, `1` otherwise (0.3.0).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdapterName } from '../../../types/index.js';
import { runEvolution } from '../../runner.js';
import { jsonDocument, progressReporter } from '../output.js';
import { booleanOption, stringOption, type CommandContext } from './context.js';

export async function commandRun(context: CommandContext): Promise<number> {
  const goal = await readFile(path.resolve(context.cwd, stringOption(context, 'goal') as string), 'utf8');
  const adapter = stringOption(context, 'adapter');
  const iterations = stringOption(context, 'iterations');
  const maxWallClockMs = stringOption(context, 'max_wall_clock_ms');

  const result = await runEvolution({
    cwd: context.cwd,
    goal,
    adapter: (adapter ?? 'codex') as AdapterName,
    iterations: iterations === undefined ? undefined : Number(iterations),
    maxWallClockMs: maxWallClockMs === undefined ? undefined : Number(maxWallClockMs),
    allowUnisolatedAgent: booleanOption(context, 'allow_unisolated_agent'),
    allowReadableHoldout: booleanOption(context, 'allow_readable_holdout'),
    onProgress: context.json ? undefined : progressReporter(context.stdout),
  });

  if (context.json) context.stdout(jsonDocument(result));
  else {
    context.stdout(`Run ${result.run_id} finished: ${result.status}.\n`);
    if (result.active_generation) context.stdout(`Active generation: ${result.active_generation.generation_id} (${result.active_generation.sha.slice(0, 12)}).\n`);
    if (result.failure) context.stdout(`Reason: ${JSON.stringify(result.failure)}\n`);
  }
  return ['ACCEPTED', 'PLATEAU'].includes(result.status) ? 0 : 1;
}
