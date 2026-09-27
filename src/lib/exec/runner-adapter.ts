/**
 * Exec domain · adapter dispatch indirection for the runner.
 *
 * `runAdapter` assembles the `runAgentAdapter` entry; `invokeAdapter` is the test injection
 * point (`adapterRunner` wins when supplied). Extracted verbatim from `src/lib/runner.js`.
 */
import { adapterAgent, adapterCommand, adapterModel, runAgentAdapter } from '../adapter.js';
import type { EvoFenceConfig } from '../../types/index.js';
import type { AdapterResultLike } from './types.js';

export interface AdapterInvocationOptions {
  adapter: string;
  config: EvoFenceConfig;
  worktree: string;
  phase: string;
  timeoutMs: number;
  maxTokensRemaining?: number | null;
  maxUsdRemaining?: number | null;
  allowUnisolatedAgent?: boolean;
  /** Carried through by `runBudgetedAdapter`; not read here. */
  iteration?: number;
  /** Carried through by `runBudgetedAdapter`; not read here. */
  contract?: unknown;
}

export type AdapterRunner = (options: AdapterInvocationOptions) => Promise<AdapterResultLike>;

export async function runAdapter({ adapter, config, worktree, phase, timeoutMs, maxTokensRemaining, maxUsdRemaining, allowUnisolatedAgent }: AdapterInvocationOptions): Promise<AdapterResultLike> {
  const entry = {
    name: adapter,
    command: adapterCommand(config, adapter),
    model: adapterModel(config, adapter),
    agent: adapterAgent(config, adapter),
    cwd: worktree,
    phase,
    timeoutMs,
    maxOutputBytes: 20_000_000,
    maxTokensRemaining,
    maxUsdRemaining,
    allowUnisolatedAgent,
  };
  return runAgentAdapter(entry);
}

export async function invokeAdapter(options: AdapterInvocationOptions, adapterRunner?: AdapterRunner | null): Promise<AdapterResultLike> {
  if (adapterRunner) return adapterRunner(options);
  return runAdapter(options);
}
