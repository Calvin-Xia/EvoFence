#!/usr/bin/env node
/**
 * EvoFence publish-workflow gate — static guard for the OIDC Trusted Publishing wiring
 * (node `l4_release` of graph `evofence-ts-refactor`, DoD 4).
 *
 * Why this exists: `publish.yml` is the one file that can publish to npm, and its
 * correctness is *not* observable from `npm test` — a dropped `id-token: write` or a
 * publish step that runs before the build only shows up as a failed (or silently wrong)
 * release. This script makes those properties machine-checkable, so they can run in the
 * workflow itself and locally.
 *
 * Checks (each one is a required property, all must hold):
 *   1. Trigger is `release: types: [published]`.
 *   2. `permissions: contents: read` is declared at the workflow level, and the publish
 *      job declares `contents: read` + `id-token: write` (the OIDC token request).
 *   3. Checkout does not persist credentials (`persist-credentials: false`), so the job
 *      cannot write back to the repository.
 *   4. A step installs the pinned npm CLI that supports Trusted Publishing, and a later
 *      step asserts `npm --version` equals that pin.
 *   5. A type-check step and a build step run before the first `npm publish`.
 *   6. `npm test` runs before the first `npm publish`.
 *   7. Every `npm publish` step passes an explicit `--tag`.
 *
 * Exit code 0 when every property holds, 1 otherwise (all violations reported at once).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLISH_WORKFLOW_PATH = '.github/workflows/publish.yml';

/** The npm CLI release that added Trusted Publishing support; pinned in the workflow. */
export const REQUIRED_NPM_CLI = '11.17.0';

const NPM_INSTALL_PATTERN = /npm\s+install\s+(?:--global|-g)\s+npm@([0-9][\w.\-]*)/;
const NPM_VERSION_CHECK_PATTERN = /npm\s+--version/;
const TYPECHECK_PATTERN = /npm\s+run\s+typecheck\b/;
const BUILD_PATTERN = /npm\s+run\s+build\b/;
const TEST_PATTERN = /npm\s+test\b/;
const PUBLISH_PATTERN = /npm\s+publish\b/;

/** Flatten every `run:` string a step (or composite step list) declares, in order. */
function stepRuns(step) {
  if (!step || typeof step !== 'object') return [];
  const { run } = step;
  return typeof run === 'string' ? [run] : [];
}

/**
 * @param {string} source raw YAML text of the publish workflow
 * @returns {{ ok: boolean, errors: string[], steps: number }}
 */
export function verifyPublishWorkflow(source, { workflowPath = PUBLISH_WORKFLOW_PATH } = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);

  let doc;
  try {
    doc = parse(source);
  } catch (error) {
    throw new Error(`${workflowPath} is not valid YAML: ${error.message}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${workflowPath} must parse to a YAML mapping`);
  }

  // YAML 1.2 core schema keeps `on` a string, but a loader running an older schema
  // resolves it to boolean true; accept either shape rather than fail confusingly.
  const triggers = doc.on ?? doc[true];
  const releaseTypes = triggers?.release?.types;
  if (!Array.isArray(releaseTypes) || !releaseTypes.includes('published')) {
    fail(`trigger must be \`release: types: [published]\`, got ${JSON.stringify(triggers?.release ?? triggers)}`);
  }

  const topPermissions = doc.permissions;
  if (topPermissions?.contents !== 'read') {
    fail(`workflow-level \`permissions: contents: read\` is required, got ${JSON.stringify(topPermissions)}`);
  }

  const job = doc.jobs?.publish;
  if (!job || typeof job !== 'object') {
    fail('a `jobs.publish` job is required');
    return { ok: errors.length === 0, errors, steps: 0 };
  }
  if (job.permissions?.contents !== 'read') {
    fail(`job \`publish\` must declare \`contents: read\`, got ${JSON.stringify(job.permissions?.contents)}`);
  }
  if (job.permissions?.['id-token'] !== 'write') {
    fail(`job \`publish\` must declare \`id-token: write\` for OIDC Trusted Publishing, got ${JSON.stringify(job.permissions?.['id-token'])}`);
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (steps.length === 0) {
    fail('job `publish` must declare steps');
    return { ok: false, errors, steps: 0 };
  }

  const checkout = steps.find((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout@'));
  if (!checkout) {
    fail('a `actions/checkout` step is required');
  } else if (checkout.with?.['persist-credentials'] !== false) {
    fail('the checkout step must set `persist-credentials: false` so the job cannot write back to the repository');
  }

  const pinnedInstalls = steps
    .map((step, index) => ({ index, match: stepRuns(step).join('\n').match(NPM_INSTALL_PATTERN) }))
    .filter(({ match }) => match !== null);
  const install = pinnedInstalls[0];
  if (!install) {
    fail('a step must install the pinned npm CLI (`npm install --global npm@<version>`)');
  } else if (install.match[1] !== REQUIRED_NPM_CLI) {
    fail(`the pinned npm CLI must be ${REQUIRED_NPM_CLI} (Trusted Publishing), got ${install.match[1]}`);
  }

  const versionCheckIndex = steps.findIndex((step) => NPM_VERSION_CHECK_PATTERN.test(stepRuns(step).join('\n')));
  if (versionCheckIndex === -1) {
    fail('a step must assert the npm CLI version (`npm --version`) used for Trusted Publishing');
  } else if (install && versionCheckIndex < install.index) {
    fail('the npm CLI version check must run after the pinned npm CLI install');
  }

  const publishIndexes = steps
    .map((step, index) => ({ index, run: stepRuns(step).join('\n') }))
    .filter(({ run }) => PUBLISH_PATTERN.test(run))
    .map(({ index }) => index);
  if (publishIndexes.length === 0) {
    fail('the job must contain an `npm publish` step');
  }
  for (const index of publishIndexes) {
    const run = stepRuns(steps[index]).join('\n');
    if (!/npm\s+publish\b[^\n]*--tag\s+\S+/.test(run)) {
      fail(`publish step #${index + 1} must pass an explicit \`--tag\` (got \`${run.trim()}\`)`);
    }
  }

  const firstPublish = publishIndexes.length > 0 ? Math.min(...publishIndexes) : steps.length;
  for (const [label, pattern] of [['type-check', TYPECHECK_PATTERN], ['build', BUILD_PATTERN], ['test', TEST_PATTERN]]) {
    const index = steps.findIndex((step) => pattern.test(stepRuns(step).join('\n')));
    if (index === -1) {
      fail(`a \`${label}\` step is required (the published artifact is built output, not the repository tree)`);
    } else if (index > firstPublish) {
      fail(`the \`${label}\` step must run before the first \`npm publish\` step`);
    }
  }

  return { ok: errors.length === 0, errors, steps: steps.length };
}

function run() {
  const source = readFileSync(path.join(REPO_ROOT, PUBLISH_WORKFLOW_PATH), 'utf8');
  const { ok, errors, steps } = verifyPublishWorkflow(source);
  if (!ok) {
    for (const error of errors) process.stderr.write(`publish workflow: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${PUBLISH_WORKFLOW_PATH}: OIDC Trusted Publishing wiring verified (${steps} steps, id-token: write, npm ${REQUIRED_NPM_CLI}).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
