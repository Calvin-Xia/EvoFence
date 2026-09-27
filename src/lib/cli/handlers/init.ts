/**
 * `evofence init` — create the control-plane skeleton.
 *
 * DOMAIN: CLI handler (node `l2_cli`). Behaviour is 0.3.0's; the only addition is the `--json`
 * view `{root, created, existing}` (ADR-0003: `--json` is uniform across the surface).
 */
import { initializeRepository } from '../../init.js';
import { jsonDocument } from '../output.js';
import type { CommandContext } from './context.js';

export async function commandInit(context: CommandContext): Promise<number> {
  const result = await initializeRepository(context.cwd);
  if (context.json) {
    context.stdout(jsonDocument({ root: result.root, created: result.created, existing: result.existing }));
    return 0;
  }
  context.stdout(result.existing
    ? `EvoFence is already initialized in ${result.root}\n`
    : `Initialized EvoFence in ${result.root}\nCreated: ${result.created.join(', ')}\n`);
  context.stdout('Review .evofence/contract.yaml and add a numeric objective plus at least one hard invariant before running agents.\n');
  return 0;
}
