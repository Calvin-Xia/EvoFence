/**
 * Gate domain · `.evofence/contract.yaml` structural validation (pure).
 *
 * Ported verbatim from `src/lib/contract.js:21-61` (0.3.0): the same 24 `INVALID_CONTRACT` /
 * `UNSUPPORTED_CONTRACT` rules, the same messages, the same two-and-only-two code defaults
 * (`evidence.per_command_timeout_ms ?? 120000`, `evidence.max_output_bytes ?? 1_048_576`).
 *
 * FAIL-CLOSED REMINDER (`docs/refactor-inventory-review.md` F3): every other field is a hard
 * `invariant`, so a missing field is `INVALID_CONTRACT` — `templates/contract.yaml` supplies
 * initial values, it does NOT supply runtime defaults. Do not add a `??` here.
 *
 * Imports: `src/types/**` + the shared base leaf `src/lib/errors.js`.
 */

import type { EvoFenceContract } from '../../types/config.js';
import { invariant } from '../errors.js';

function stringArray(value: unknown, label: string): void {
  invariant(Array.isArray(value) && value.every((item) => typeof item === 'string'), 'INVALID_CONTRACT', `${label} must be a list of strings.`);
}

/** Validate the parsed contract document; returns it unchanged. */
export function validateContract(contract: EvoFenceContract): EvoFenceContract {
  invariant(contract.contract_version === 1, 'UNSUPPORTED_CONTRACT', 'contract_version must be 1.');
  invariant(contract.objective && typeof contract.objective === 'object', 'INVALID_CONTRACT', 'objective must be an object.');
  invariant(typeof contract.objective.name === 'string' && contract.objective.name.trim(), 'INVALID_CONTRACT', 'objective.name is required.');
  invariant(typeof contract.objective.command === 'string', 'INVALID_CONTRACT', 'objective.command must be a string.');
  invariant(['maximize', 'minimize'].includes(contract.objective.direction), 'INVALID_CONTRACT', 'objective.direction must be maximize or minimize.');
  invariant(Number.isFinite(contract.objective.min_delta) && contract.objective.min_delta >= 0, 'INVALID_CONTRACT', 'objective.min_delta must be a non-negative number.');

  invariant(Array.isArray(contract.hard_invariants), 'INVALID_CONTRACT', 'hard_invariants must be a list.');
  const invariantIds = new Set<string>();
  for (const item of contract.hard_invariants) {
    invariant(item && typeof item === 'object', 'INVALID_CONTRACT', 'Each hard invariant must be an object.');
    invariant(typeof item.id === 'string' && item.id.trim(), 'INVALID_CONTRACT', 'Each hard invariant requires an id.');
    invariant(typeof item.command === 'string' && item.command.trim(), 'INVALID_CONTRACT', `Hard invariant ${item.id} requires a command.`);
    invariant(!invariantIds.has(item.id), 'INVALID_CONTRACT', `Duplicate hard invariant id: ${item.id}.`);
    invariantIds.add(item.id);
  }

  stringArray(contract.allowed_evolution_surface, 'allowed_evolution_surface');
  stringArray(contract.protected_paths, 'protected_paths');
  invariant(contract.evidence && typeof contract.evidence === 'object', 'INVALID_CONTRACT', 'evidence must be an object.');
  stringArray(contract.evidence.public_commands, 'evidence.public_commands');
  const timeout = contract.evidence.per_command_timeout_ms ?? 120000;
  invariant(Number.isInteger(timeout) && timeout >= 100 && timeout <= 86_400_000, 'INVALID_CONTRACT', 'evidence.per_command_timeout_ms must be between 100 and 86400000.');
  const maxOutput = contract.evidence.max_output_bytes ?? 1_048_576;
  invariant(Number.isInteger(maxOutput) && maxOutput >= 1024 && maxOutput <= 100_000_000, 'INVALID_CONTRACT', 'evidence.max_output_bytes must be between 1024 and 100000000.');

  invariant(contract.acceptance && typeof contract.acceptance === 'object', 'INVALID_CONTRACT', 'acceptance must be an object.');
  invariant(contract.acceptance.require_rollback_point === true, 'INVALID_CONTRACT', 'require_rollback_point must remain true.');
  invariant(Number.isInteger(contract.acceptance.hidden_regression_tolerance) && contract.acceptance.hidden_regression_tolerance >= 0, 'INVALID_CONTRACT', 'acceptance.hidden_regression_tolerance must be a non-negative integer.');

  invariant(contract.capabilities && typeof contract.capabilities === 'object', 'INVALID_CONTRACT', 'capabilities must be an object.');
  invariant(['A0', 'A1', 'A2', 'A3'].includes(contract.capabilities.authority_ceiling), 'INVALID_CONTRACT', 'authority_ceiling must be A0, A1, A2, or A3. A4 cannot be automatically granted.');

  invariant(contract.budgets && typeof contract.budgets === 'object', 'INVALID_CONTRACT', 'budgets must be an object.');
  for (const key of ['max_iterations', 'max_wall_clock_ms', 'max_failed_candidates', 'max_consecutive_no_improvement'] as const) {
    invariant(Number.isInteger(contract.budgets[key]) && contract.budgets[key] >= 1, 'INVALID_CONTRACT', `budgets.${key} must be a positive integer.`);
  }
  invariant(contract.budgets.max_tokens === null || (Number.isSafeInteger(contract.budgets.max_tokens) && contract.budgets.max_tokens > 0), 'INVALID_CONTRACT', 'budgets.max_tokens must be null or a positive safe integer.');
  invariant(contract.budgets.max_usd === null || (Number.isFinite(contract.budgets.max_usd) && contract.budgets.max_usd > 0), 'INVALID_CONTRACT', 'budgets.max_usd must be null or a positive number.');
  return contract;
}
