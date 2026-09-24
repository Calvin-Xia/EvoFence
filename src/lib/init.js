import { copyFile, constants, mkdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './git.js';
import { EvoFenceError, invariant } from './errors.js';

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
`;

const schemaFiles = {
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

async function ensureDirectorySafe(root, directory) {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  invariant(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to initialize through a symbolic link: ${directory}`);
  invariant(path.resolve(directory).startsWith(`${path.resolve(root)}${path.sep}`), 'PATH_ESCAPE', `Initialization path escapes repository: ${directory}`);
}

async function copyIfMissing(source, destination) {
  try {
    const info = await lstat(destination);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${destination}`);
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  return true;
}

export async function initializeRepository(cwd) {
  const root = await repositoryRoot(cwd);
  const directory = path.join(root, '.evofence');
  await ensureDirectorySafe(root, directory);
  for (const name of ['private', 'prompts', 'schemas']) {
    await ensureDirectorySafe(root, path.join(directory, name));
  }

  const created = [];
  const files = [
    ['contract.yaml', path.join(templates, 'contract.yaml')],
    ['private/holdout.yaml', path.join(templates, 'private-holdout.yaml')],
    ['prompts/proposer.md', path.join(templates, 'proposer.md')],
    ['prompts/analyst.md', path.join(templates, 'analyst.md')],
  ];
  for (const [relative, source] of files) {
    if (await copyIfMissing(source, path.join(directory, relative))) created.push(path.join('.evofence', relative));
  }
  const config = path.join(directory, 'config.yaml');
  try {
    const info = await lstat(config);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${config}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(config, configTemplate, { flag: 'wx', mode: 0o600 });
    created.push('.evofence/config.yaml');
  }
  const ignore = path.join(directory, '.gitignore');
  const ignoreContent = 'ledger.sqlite*\nartifacts/\nprivate/\nout/\nactive-run.json\n';
  try {
    const info = await lstat(ignore);
    invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${ignore}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(ignore, ignoreContent, { flag: 'wx', mode: 0o600 });
    created.push('.evofence/.gitignore');
  }
  for (const [name, schema] of Object.entries(schemaFiles)) {
    const destination = path.join(directory, 'schemas', name);
    try {
      const info = await lstat(destination);
      invariant(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to follow a non-regular initialization file: ${destination}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(destination, `${JSON.stringify(schema, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      created.push(path.join('.evofence', 'schemas', name));
    }
  }

  return { root, created, existing: created.length === 0 };
}
