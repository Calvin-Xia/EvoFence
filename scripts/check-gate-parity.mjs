/**
 * Gate-parity guard (audit G10).
 *
 * `.github/workflows/ci.yml` hand-replicates the `npm run check` composition instead of calling it,
 * and the workflow itself says so. That is a deliberate choice — each gate reports its own failure —
 * but it means dropping a script from `package.json#scripts.check`, or dropping its CI step, changes
 * the project gate silently. This guard reads both files and asserts:
 *
 *   1. every script inside `check` is executed by a CI step;
 *   2. both workflows declare a job `timeout-minutes` (`node --test` has no default timeout, so a
 *      hung test otherwise holds a runner until GitHub's six-hour default).
 *
 * It is not part of `check` (it audits CI, not the source tree); CI runs it as its own step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `npm run a && npm run b && npm test` -> ['a', 'b', 'test']. */
export function scriptsIn(command) {
  return String(command)
    .split('&&')
    .map((part) => part.trim())
    .map((part) => /^npm (?:run )?([\w:-]+)$/.exec(part))
    .filter((match) => match !== null)
    .map((match) => match[1]);
}

/** Names of the npm scripts a workflow executes through `run: npm ...`. */
export function workflowScripts(workflowText) {
  const found = new Set();
  for (const match of workflowText.matchAll(/run:\s*npm (?:run )?([\w:-]+)/g)) found.add(match[1]);
  for (const match of workflowText.matchAll(/run:\s*(npm (?:run )?[\w:-]+)/g)) found.add(scriptsIn(match[1])[0]);
  return found;
}

/**
 * Problems found, as human-readable lines. An empty array means the composition is in parity.
 * The inputs are parameters so the negative controls in `test/gate-parity.test.js` can mutate them.
 */
export function gateParityProblems({ pkg, ci, publish }) {
  const problems = [];
  const checkScripts = scriptsIn(pkg?.scripts?.check ?? '');
  if (checkScripts.length === 0) problems.push('package.json#scripts.check does not name any npm script');
  const ciRuns = workflowScripts(ci ?? '');
  for (const name of checkScripts) {
    if (!ciRuns.has(name)) {
      problems.push(`check runs "${name}" but .github/workflows/ci.yml never executes it`);
    }
  }
  for (const [file, workflow] of [['ci.yml', ci], ['publish.yml', publish]]) {
    if (!/timeout-minutes:\s*\d+/m.test(workflow ?? '')) {
      problems.push(`.github/workflows/${file} declares no job timeout-minutes`);
    }
  }
  return problems;
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const read = (name) => readFileSync(path.join(root, name), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const problems = gateParityProblems({
    pkg,
    ci: read('.github/workflows/ci.yml'),
    publish: read('.github/workflows/publish.yml'),
  });
  const checkScripts = scriptsIn(pkg.scripts.check);
  process.stdout.write(`gate parity: check = ${checkScripts.join(' + ')}; ${problems.length} problem(s)\n`);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`- ${problem}\n`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
