import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { EvoFenceError, invariant } from './errors.js';
import { assertInside } from './fs.js';

const stringArray = (value, label) => {
  invariant(Array.isArray(value) && value.every((item) => typeof item === 'string'), 'INVALID_CONTRACT', `${label} must be a list of strings.`);
};

function parseYaml(text, filename) {
  const document = parseDocument(text, { uniqueKeys: true, schema: 'core' });
  if (document.errors.length) {
    throw new EvoFenceError('INVALID_YAML', `${filename}: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  const value = document.toJS();
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONTRACT', `${filename} must contain a YAML object.`);
  return value;
}

export function validateContract(contract) {
  invariant(contract.contract_version === 1, 'UNSUPPORTED_CONTRACT', 'contract_version must be 1.');
  invariant(contract.objective && typeof contract.objective === 'object', 'INVALID_CONTRACT', 'objective must be an object.');
  invariant(typeof contract.objective.name === 'string' && contract.objective.name.trim(), 'INVALID_CONTRACT', 'objective.name is required.');
  invariant(typeof contract.objective.command === 'string', 'INVALID_CONTRACT', 'objective.command must be a string.');
  invariant(['maximize', 'minimize'].includes(contract.objective.direction), 'INVALID_CONTRACT', 'objective.direction must be maximize or minimize.');
  invariant(Number.isFinite(contract.objective.min_delta) && contract.objective.min_delta >= 0, 'INVALID_CONTRACT', 'objective.min_delta must be a non-negative number.');

  invariant(Array.isArray(contract.hard_invariants), 'INVALID_CONTRACT', 'hard_invariants must be a list.');
  const invariantIds = new Set();
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
  for (const key of ['max_iterations', 'max_wall_clock_ms', 'max_failed_candidates', 'max_consecutive_no_improvement']) {
    invariant(Number.isInteger(contract.budgets[key]) && contract.budgets[key] >= 1, 'INVALID_CONTRACT', `budgets.${key} must be a positive integer.`);
  }
  invariant(contract.budgets.max_tokens === null || (Number.isSafeInteger(contract.budgets.max_tokens) && contract.budgets.max_tokens > 0), 'INVALID_CONTRACT', 'budgets.max_tokens must be null or a positive safe integer.');
  invariant(contract.budgets.max_usd === null || (Number.isFinite(contract.budgets.max_usd) && contract.budgets.max_usd > 0), 'INVALID_CONTRACT', 'budgets.max_usd must be null or a positive number.');
  return contract;
}

export async function loadYamlFile(filename, root = path.dirname(filename)) {
  let text;
  try {
    const info = await lstat(filename);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_POLICY_FILE', `Policy file must be a regular file: ${filename}`);
    const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(filename)]);
    assertInside(canonicalRoot, canonicalFile);
    text = await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new EvoFenceError('MISSING_FILE', `Required file not found: ${filename}`);
    throw error;
  }
  return parseYaml(text, filename);
}

export async function loadContract(root) {
  const file = path.join(root, '.evofence', 'contract.yaml');
  return validateContract(await loadYamlFile(file, root));
}

export async function loadPrivateHoldout(root) {
  const file = path.join(root, '.evofence', 'private', 'holdout.yaml');
  try {
    const value = await loadYamlFile(file, root);
    invariant(Array.isArray(value.regressions), 'INVALID_HOLDOUT', 'private holdout regressions must be a list.');
    const ids = new Set();
    for (const regression of value.regressions) {
      invariant(regression && typeof regression === 'object', 'INVALID_HOLDOUT', 'Each private regression must be an object.');
      invariant(typeof regression.id === 'string' && regression.id.trim(), 'INVALID_HOLDOUT', 'Each private regression requires an id.');
      invariant(typeof regression.command === 'string' && regression.command.trim(), 'INVALID_HOLDOUT', `Private regression ${regression.id} requires a command.`);
      invariant(!ids.has(regression.id), 'INVALID_HOLDOUT', `Duplicate private regression id: ${regression.id}.`);
      ids.add(regression.id);
    }
    return value.regressions;
  } catch (error) {
    if (error.code === 'MISSING_FILE') return [];
    throw error;
  }
}

export function parseYamlText(text, filename = '<yaml>') {
  return parseYaml(text, filename);
}
