/**
 * `evofence init`: repository scaffolding.
 *
 * Converted from `src/lib/init.js` (L2 io domain, node `l2_config`). The only export,
 * `initializeRepository`, keeps its signature, return shape, and the "never overwrite an
 * existing file" behavior.
 *
 * WHAT IS NEW HERE (node `l2_config`): after the scaffolding exists, both policy files are run
 * through the v2 validator. `init` therefore cannot leave a repository whose own
 * `contract.yaml` / `config.yaml` would be rejected on the next `status` — a broken template
 * fails at creation time instead of at the first read.
 */
import { copyFile, constants, mkdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './git.js';
import { invariant } from './errors.js';
import { Ledger, ledgerPath } from './ledger.js';
import { POLICY_FILES, assertValidReport, validatePolicyFileSync } from './config/index.js';

const templates = fileURLToPath(new URL('../../templates/', import.meta.url));

const configTemplate = `version: 1
adapters:
  codex:
    command: codex
    model: null
  opencode:
    command: opencode
    model: null
    agent: null
  claude:
    command: claude
    model: null
    agent: null
  pi:
    command: pi
    model: null
`;

const schemaFiles: Record<string, unknown> = {
  'proposal.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'EvoFence Proposal',
    type: 'object',
    required: ['iteration', 'base_sha', 'hypothesis', 'problem_evidence', 'proposed_change', 'changed_surface', 'expected_effect', 'possible_regressions', 'requested_capabilities', 'falsification_plan', 'rollback_plan'],
    properties: {
      iteration: { type: 'integer', minimum: 1 },
      base_sha: { type: 'string', pattern: '^[0-9a-f]{40,64}$' },
      hypothesis: { type: 'string', minLength: 1 },
      problem_evidence: { type: 'array', items: { type: 'string' } },
      proposed_change: { type: 'string', minLength: 1 },
      changed_surface: { type: 'array', items: { type: 'string' } },
      expected_effect: {
        type: 'object',
        required: ['primary_metric', 'direction', 'minimum_practical_effect'],
        properties: {
          primary_metric: { type: 'string' },
          direction: { enum: ['increase', 'decrease'] },
          minimum_practical_effect: { type: 'string' },
        },
        additionalProperties: true,
      },
      possible_regressions: { type: 'array', items: { type: 'string' } },
      requested_capabilities: { type: 'array' },
      falsification_plan: { type: 'array', items: { type: 'string' }, minItems: 1 },
      rollback_plan: { type: 'string', minLength: 1 },
    },
    additionalProperties: true,
  },
  'claims.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'EvoFence Claims',
    type: 'object',
    required: ['status', 'claims', 'tests_executed', 'known_failures', 'missing_evidence', 'files_changed', 'capabilities_used', 'suggested_gate_checks'],
    properties: {
      status: { enum: ['CANDIDATE_READY', 'NO_CHANGE', 'BLOCKED'] },
      claims: { type: 'array' },
      tests_executed: { type: 'array' },
      known_failures: { type: 'array' },
      missing_evidence: { type: 'array' },
      files_changed: { type: 'array', items: { type: 'string' } },
      capabilities_used: { type: 'array' },
      suggested_gate_checks: { type: 'array' },
    },
    additionalProperties: true,
  },
};

/** `err.code` for a non-`Error` throw. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function ensureDirectorySafe(root: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  invariant(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to initialize through a symbolic link: ${directory}`);
  invariant(path.resolve(directory).startsWith(`${path.resolve(root)}${path.sep}`), 'PATH_ESCAPE', `Initialization path escapes repository: ${directory}`);
}

async function copyIfMissing(source: string, destination: string): Promise<boolean> {
  try {
    const info = await lstat(destination);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${destination}`);
    return false;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  return true;
}

/** Ensure one initialization file exists and is a regular file; returns `true` when created. */
async function ensureFile(destination: string, contents: string): Promise<boolean> {
  try {
    const info = await lstat(destination);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${destination}`);
    return false;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
  return true;
}

export interface InitializationResult {
  /** Absolute repository root. */
  root: string;
  /** Repository-relative paths created by this call. */
  created: string[];
  /** `true` when every control-plane file already existed. */
  existing: boolean;
}

export async function initializeRepository(cwd: string): Promise<InitializationResult> {
  const root = await repositoryRoot(cwd);
  const directory = path.join(root, '.evofence');
  await ensureDirectorySafe(root, directory);
  for (const name of ['private', 'prompts', 'schemas']) {
    await ensureDirectorySafe(root, path.join(directory, name));
  }

  const created: string[] = [];
  const files: Array<[string, string]> = [
    ['contract.yaml', path.join(templates, 'contract.yaml')],
    ['private/holdout.yaml', path.join(templates, 'private-holdout.yaml')],
    ['prompts/proposer.md', path.join(templates, 'proposer.md')],
    ['prompts/analyst.md', path.join(templates, 'analyst.md')],
  ];
  for (const [relative, source] of files) {
    if (await copyIfMissing(source, path.join(directory, relative))) created.push(path.join('.evofence', relative));
  }
  if (await ensureFile(path.join(directory, 'config.yaml'), configTemplate)) created.push('.evofence/config.yaml');
  const ignoreContent = 'ledger.sqlite*\nartifacts/\nprivate/\nout/\nactive-run.json\n';
  if (await ensureFile(path.join(directory, '.gitignore'), ignoreContent)) created.push('.evofence/.gitignore');
  for (const [name, schema] of Object.entries(schemaFiles)) {
    const destination = path.join(directory, 'schemas', name);
    if (await ensureFile(destination, `${JSON.stringify(schema, null, 2)}\n`)) created.push(path.join('.evofence', 'schemas', name));
  }

  const ledgerFile = ledgerPath(root);
  try {
    const info = await lstat(ledgerFile);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${ledgerFile}`);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    const ledger = new Ledger(ledgerFile);
    ledger.close();
    created.push(path.join('.evofence', 'ledger.sqlite'));
  }

  // Fail closed on a scaffolding this control plane itself would refuse to load.
  const contractReport = validatePolicyFileSync('contract', root, POLICY_FILES.contract);
  if (contractReport) assertValidReport(contractReport);
  const configReport = validatePolicyFileSync('config', root, POLICY_FILES.config);
  if (configReport) assertValidReport(configReport);

  return { root, created, existing: created.length === 0 };
}
