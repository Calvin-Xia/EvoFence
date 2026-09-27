/**
 * Exec domain · per-iteration task file rendering and the failure packet fed back to the agent.
 * Extracted verbatim from `src/lib/runner.js`.
 */
import type { EvoFenceContract } from '../../types/index.js';

const BUILTIN_TASK_RULES = `The control plane owns the contract, evidence, and decision. Do not change protected files. Do not claim acceptance. Keep the patch atomic and reversible.`;

/** Arguments for {@link taskContents}; `previousFailure` is the prior failure packet, if any. */
export interface TaskContentsInput {
  goal: string;
  iteration: number;
  baseSha: string;
  contract: EvoFenceContract;
  previousFailure?: string | null;
  phase: string;
}

export function taskContents({ goal, iteration, baseSha, contract, previousFailure, phase }: TaskContentsInput): string {
  const summary = {
    contract_version: contract.contract_version,
    objective: contract.objective,
    hard_invariants: contract.hard_invariants.map(({ id }) => ({ id })),
    allowed_evolution_surface: contract.allowed_evolution_surface,
    protected_paths: contract.protected_paths,
    network: contract.capabilities.network,
    dependency_install: contract.capabilities.dependency_install,
    credentials: contract.capabilities.credentials,
  };
  return [
    '# EvoFence task',
    '',
    `Phase: ${phase}`,
    `Iteration: ${iteration}`,
    `Base generation: ${baseSha}`,
    '',
    '## Goal',
    goal.trim(),
    '',
    '## Control-plane policy snapshot',
    'Treat this summary as read-only. The controller has a separate authoritative copy.',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    previousFailure ? `## Previous failure packet\n${previousFailure}` : '',
    '',
    BUILTIN_TASK_RULES,
    phase === 'proposal'
      ? 'Create only .evofence-out/proposal.json. Do not modify project files in this phase.'
      : 'Implement only the approved proposal in .evofence-out/proposal.json. Then write .evofence-out/claims.json. Do not modify the proposal.',
    '',
  ].filter(Boolean).join('\n');
}

/**
 * Public failure packet re-fed to the next iteration. `private_regressions` is always replaced
 * with a constant string so hidden-oracle details never reach the agent.
 */
export function publicFailurePacket(decision: string, details: object): string {
  const visible: Record<string, unknown> = { decision, ...details };
  if (visible.private_regressions) {
    visible.private_regressions = 'failed; private oracle details withheld';
  }
  return `The previous candidate was ${decision}.\n\n${JSON.stringify(visible, null, 2)}\n\nDo not weaken tests or request hidden oracle details.`;
}
