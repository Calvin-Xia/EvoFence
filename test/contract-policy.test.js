import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDocument } from '../dist/lib/config/index.js';
import { parseYamlText, validateContract } from '../dist/lib/contract.js';
import { assessCapabilities, assessRisk, checkChangedPaths, checkClaims, checkProposal, isAllowedPath, isProtectedPath, matchesGlob } from '../dist/lib/policy.js';
import {
  DEAD_CONTRACT_KEYS,
  capabilitySetting,
  decisionForCandidateCheck,
  evaluateBudgetGate,
  evaluateCapabilityGate,
  evaluateContractGate,
  evaluateEvidenceGate,
  evaluateIsolationGate,
  evaluatePolicyGate,
  isCapabilityAllowed,
  isDeadContractKey,
  parseNumericBudget,
  remainingTokenBudget,
  usdFromMicros,
  usdToMicros,
  verdictForEvidence,
  verdictForRisk,
} from '../dist/lib/gate/index.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

/**
 * Every TypeScript file under `src/` whose text contains `needle`, as repo-relative POSIX paths.
 *
 * The gate domain's machine-readable ledger (`DEAD_CONTRACT_KEYS`, `dead-keys.ts`) publishes
 * `grep`-verifiable evidence strings, so this test re-runs the grep instead of trusting prose
 * (review F10). Line numbers are deliberately not asserted: they drift on unrelated edits.
 */
async function grepSources(needle) {
  const hits = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if ((await readFile(full, 'utf8')).includes(needle)) {
        hits.push(path.relative(projectRoot, full).split(path.sep).join('/'));
      }
    }
  };
  await walk(path.join(projectRoot, 'src'));
  return hits.sort();
}

test('the generated contract template validates and YAML duplicate keys are rejected', async () => {
  const template = await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8');
  assert.doesNotThrow(() => validateContract(parseYamlText(template, 'contract.yaml')));
  assert.throws(() => parseYamlText('value: 1\nvalue: 2\n', 'duplicate.yaml'), /Map keys must be unique/);
});

test('token budgets require positive safe integers', async () => {
  const template = parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8'));
  assert.doesNotThrow(() => validateContract({ ...template, budgets: { ...template.budgets, max_tokens: 1 } }));
  assert.throws(() => validateContract({ ...template, budgets: { ...template.budgets, max_tokens: 1.5 } }), /positive safe integer/);
  assert.throws(() => validateContract({ ...template, budgets: { ...template.budgets, max_tokens: Number.MAX_SAFE_INTEGER + 1 } }), /positive safe integer/);
});

test('glob matching supports recursive and single-segment patterns', () => {
  assert.equal(matchesGlob('src/file.js', '**/*'), true);
  assert.equal(matchesGlob('src/nested/file.js', 'src/**/*.js'), true);
  assert.equal(matchesGlob('src/file.test.js', '**/*.test.*'), true);
  assert.equal(matchesGlob('src/file.js', 'src/*.js'), true);
  assert.equal(matchesGlob('src/nested/file.js', 'src/*.js'), false);
});

test('policy protects tests, manifests, local policy, and CI by default', async () => {
  const contract = validateContract(parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8')));
  for (const filename of ['tests/test_gate.py', 'src/unit.test.js', 'package.json', '.evofence/contract.yaml', '.github/workflows/ci.yml']) {
    assert.equal(isProtectedPath(filename, contract), true, filename);
  }
  assert.equal(isAllowedPath('src/new_feature.js', contract), true);
  assert.deepEqual(checkChangedPaths(['src/new_feature.js', 'tests/test_gate.py'], contract), [
    { path: 'tests/test_gate.py', category: 'protected_path' },
  ]);
});

test('proposal and claims require structured evidence fields', () => {
  const proposal = {
    iteration: 1,
    base_sha: 'a'.repeat(40),
    hypothesis: 'A cache will reduce repeated work.',
    problem_evidence: ['The baseline repeats the parse.'],
    proposed_change: 'Cache the parsed result.',
    changed_surface: ['src/parser.js'],
    expected_effect: { primary_metric: 'score', direction: 'increase', minimum_practical_effect: '0.01' },
    possible_regressions: ['Stale result.'],
    requested_capabilities: [],
    falsification_plan: ['Compare repeat inputs.'],
    rollback_plan: 'Remove the cache.',
  };
  assert.equal(checkProposal(proposal), proposal);
  const claims = { status: 'CANDIDATE_READY', claims: [], tests_executed: [], known_failures: [], missing_evidence: [], files_changed: ['src/parser.js'], capabilities_used: [], suggested_gate_checks: [] };
  assert.equal(checkClaims(claims), claims);
  assert.throws(() => checkProposal({ ...proposal, base_sha: 'short' }), /full git commit SHA/);
});

test('capability requests default to denied and risk grows with surface', async () => {
  const contract = validateContract(parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8')));
  assert.equal(assessCapabilities({ requested_capabilities: ['network'] }, contract).allowed, false);
  assert.equal(assessCapabilities({ requested_capabilities: [] }, contract).allowed, true);
  const small = assessRisk(['src/a.js'], { requested_capabilities: [], expected_effect: { primary_metric: contract.objective.name } }, contract);
  const broad = assessRisk(Array.from({ length: 22 }, (_, index) => `src/${index}.js`), { requested_capabilities: [], expected_effect: { primary_metric: contract.objective.name } }, contract);
  assert.ok(broad.score > small.score);
});

/* l2_gate DoD evidence. ADDITIVE: the six tests above are unchanged apart from their import
 * specifiers (`../src/...` -> `../dist/...`, L2 R4 / ADR-0004). */

const templateContract = async () => parseYamlText(await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8'), 'contract.yaml');

const caseSummary = (passed, score) => ({
  command_sha256: 'a'.repeat(64), passed, result: passed ? 'PASS' : 'FAIL', exit_code: passed ? 0 : 1, duration_ms: 1,
  stdout_sha256: 'b'.repeat(64), stderr_sha256: 'c'.repeat(64), stdout_bytes: 1, stderr_bytes: 1, hidden: false,
  ...(score === undefined ? {} : { score }),
});

const evidenceBundle = (overrides = {}) => ({
  schema_version: 1, run_id: 'run-1', iteration: 1, phase: 'candidate', candidate_sha: null,
  started_at: '2026-01-01T00:00:00.000Z', duration_ms: 1, public: [caseSummary(true)],
  private: { total: 0, passed: 0, failed: 0, cases: [] }, objective: null,
  all_public_passed: true, all_private_within_tolerance: true, ...overrides,
});

const objectiveBundle = (score, overrides = {}) => evidenceBundle({ objective: { ...caseSummary(true, score), configured: true, valid_score: true }, ...overrides });

const budgetLimits = { max_iterations: 20, max_wall_clock_ms: 3600000, max_failed_candidates: 5, max_consecutive_no_improvement: 3, max_tokens: null, max_usd: null };
const budgetBase = { limits: budgetLimits, observed_tokens: null, observed_usd_micros: null, cost_total_unknown: false, deadline_at: 1000, failed_candidates: 0, consecutive_no_improvement: 0, can_terminate_process_tree: true };

const metadata = { path: '/w/.git', contents: new Uint8Array([1]), sha256: 'a'.repeat(64) };
const isolationBase = { expected_metadata: metadata, observed_metadata: { ...metadata }, holdout_ignored: undefined, unisolated_agent_accepted: false, readable_holdout_accepted: false, adapter_requires_sandbox: false };

// ------------------------------------------------------------------ *
// REFERENCE-IMPLEMENTATION LOCKS (fix batch R2 · review F3).
//
// Every `evaluate*Gate` / `verdict*` case below marked "(reference implementation, unwired)"
// calls a gate entry point that has NO production caller (see the WIRING STATUS block in
// `src/lib/gate/index.ts`). The shipped run path decides in `src/lib/exec/budget.ts`
// (accounting) and `src/lib/exec/runner-budgeted.ts` (pre-invocation allowance). A green run
// there therefore proves the reference implementation is self-consistent — it does NOT mean the
// running product behaves that way. The production side of the same decisions is pinned, and
// asserted to agree on the thresholds and on the usage-unavailable cases, by
// `test/fix-gate-wiring.test.js`. Cases that call a *wired* helper (`checkProposal`,
// `assessCapabilities`, `capabilitySetting`, `matchesGlob`, `isProtectedPath`) are not marked.
// ------------------------------------------------------------------ *

// DoD 3 — every judgement face refuses, and names the missing input, instead of passing.
// Reference implementation only (see the block above): no production caller today.
test('gate judgement entries (reference implementation, unwired) fail closed and name the missing input', () => {
  const policy = evaluatePolicyGate(undefined);
  assert.deepEqual([policy.passed, policy.reason, policy.missing], [false, 'GATE_INPUT_MISSING', ['input']]);
  const contract = evaluateContractGate(null);
  assert.deepEqual([contract.passed, contract.drifted, contract.missing], [false, true, ['input']]);
  assert.deepEqual(evaluateContractGate({ initial: { contract: 'a' }, current: { contract: 'a' } }).missing, ['initial.holdout', 'initial.config', 'current.holdout', 'current.config']);
  const budget = evaluateBudgetGate(undefined);
  assert.deepEqual([budget.passed, budget.exhausted, budget.missing], [false, false, ['input']]);
  const isolation = evaluateIsolationGate(undefined);
  assert.deepEqual([isolation.passed, isolation.isolated, isolation.missing], [false, false, ['input']]);
  const evidence = evaluateEvidenceGate(null);
  assert.deepEqual([evidence.passed, evidence.evidence_ok, evidence.objective_valid], [false, false, false]);
  const capability = evaluateCapabilityGate({ proposal: { requested_capabilities: ['network'] }, contract: null });
  assert.deepEqual([capability.passed, capability.allowed, capability.missing], [false, false, ['contract']]);
  assert.deepEqual(capability.requests, [{ capability: 'network', allowed: false, scope: null, reason: 'not_allowed_by_contract' }]);
});

// DoD 1 + 3 — the contract gate is an independent entry point over the three policy digests.
// Reference implementation only: the run path compares `currentPolicyHashes` inline.
test('contract gate (reference implementation, unwired) attributes drift to the changed policy document', () => {
  const hashes = { contract: 'a'.repeat(64), holdout: 'b'.repeat(64), config: 'c'.repeat(64) };
  const stable = evaluateContractGate({ initial: hashes, current: { ...hashes } }, 'PROPOSAL');
  assert.deepEqual([stable.passed, stable.drifted, stable.changed], [true, false, null]);
  const drifted = evaluateContractGate({ initial: hashes, current: { ...hashes, holdout: 'd'.repeat(64) } }, 'RUN');
  assert.deepEqual([drifted.passed, drifted.changed, drifted.reason], [false, 'holdout', 'POLICY_CHANGED_DURING_RUN']);
});

// DoD 4 — `capabilities.external_api` is a live gate reached through the dynamic contract table.
// WIRED half: `capabilitySetting` / `assessCapabilities` run in production via `src/lib/policy.ts`
// (consumed by `src/lib/exec/runner-iteration.ts`). Reference half: the `evaluateCapabilityGate`
// assertions at the end of this test have no production caller (review F3).
test('capabilities.external_api is a live dynamic-table capability gate', async () => {
  const template = await templateContract();
  assert.equal(template.capabilities.external_api, 'deny');
  assert.equal(capabilitySetting('external_api', template), 'deny');
  assert.equal(isCapabilityAllowed(capabilitySetting('external_api', template)), false);
  const denied = assessCapabilities({ requested_capabilities: [{ capability: 'external_api', scope: 'openai' }] }, template);
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.requests, [{ capability: 'external_api', allowed: false, scope: 'openai', reason: 'not_allowed_by_contract' }]);
  const permissive = { ...template, capabilities: { ...template.capabilities, external_api: 'allow' } };
  assert.equal(assessCapabilities({ requested_capabilities: ['external_api'] }, permissive).requests[0].reason, 'policy_allow');
  assert.equal(evaluateCapabilityGate({ proposal: { requested_capabilities: ['external_api'] }, contract: permissive }).passed, true);
  assert.equal(evaluateCapabilityGate({ proposal: { requested_capabilities: ['external_api'] }, contract: template }).reason, 'CAPABILITY_DENIED');
});

// DoD 5 — the old acceptance keys remain compatibility-only; the removed shell shape is absent.
// The evidence strings are re-grepped here (review F10) so they cannot rot into a claim the
// source contradicts.
test('legacy acceptance keys remain compatibility-only and the dead shell shape is removed', async () => {
  const text = await readFile(path.join(projectRoot, 'templates', 'contract.yaml'), 'utf8');
  assert.doesNotMatch(text, /require_proposal:/);
  assert.doesNotMatch(text, /require_claims:/);
  assert.doesNotMatch(text, /evidence_commands_only/);
  assert.deepEqual(DEAD_CONTRACT_KEYS.map((entry) => entry.path), ['acceptance.require_proposal', 'acceptance.require_claims']);
  assert.deepEqual(DEAD_CONTRACT_KEYS.map((entry) => entry.status), ['compatibility_only', 'compatibility_only']);
  assert.ok(DEAD_CONTRACT_KEYS.every((entry) => entry.evidence.length > 0));

  // F10 — each `evidence` string must be falsifiable by grep and must survive the attempt.
  const validationLayerHits = ['src/lib/config/schema.ts', 'src/lib/config/validate.ts', 'src/lib/gate/dead-keys.ts', 'src/types/config.ts'];
  assert.deepEqual(await grepSources('require_proposal'), validationLayerHits);
  assert.deepEqual(await grepSources('require_claims'), validationLayerHits);
  assert.deepEqual(await grepSources('capabilities.shell.mode'), []);
  assert.equal(DEAD_CONTRACT_KEYS.every((entry) => !entry.evidence.includes('no reference under src/')), true);
  const byPath = new Map(DEAD_CONTRACT_KEYS.map((entry) => [entry.path, entry.evidence]));
  for (const dotted of ['acceptance.require_proposal', 'acceptance.require_claims']) {
    assert.match(byPath.get(dotted), /config\/schema\.ts/);
    assert.match(byPath.get(dotted), /config\/validate\.ts/);
  }
  assert.equal(isDeadContractKey('capabilities.shell.mode'), false);
  assert.equal(isDeadContractKey('acceptance.require_proposal'), true);
  assert.equal(isDeadContractKey('capabilities.external_api'), false);
  const template = await templateContract();
  const legacy = { ...template, acceptance: { ...template.acceptance, require_proposal: true, require_claims: true } };
  assert.equal(validateDocument('contract', legacy, '<legacy>').valid, true);
  assert.doesNotThrow(() => validateContract(legacy));
  assert.throws(() => checkProposal({}), /proposal\.iteration/);
  assert.throws(() => checkClaims({}), /claims\.status/);
  assert.equal(assessCapabilities({ requested_capabilities: ['network'] }, template).allowed, false);
  assert.equal(assessCapabilities({ requested_capabilities: ['network'] }, { ...template, capabilities: { ...template.capabilities, network: 'allow' } }).allowed, true);
});

// DoD 1 — the budget thresholds are pure, and accounting stays in the exec domain.
// Reference implementation only (see the block above): the run path uses `exec/budget.ts`.
test('budget judgement (reference implementation, unwired) keeps the 0.3.0 thresholds and fails closed on missing counters', () => {
  assert.equal(parseNumericBudget(undefined, 20, '--iterations'), 20);
  assert.equal(parseNumericBudget(null, 3600000, '--max-wall-clock-ms'), 3600000);
  assert.equal(parseNumericBudget('3', 20, '--iterations'), 3);
  assert.throws(() => parseNumericBudget(0, 20, '--iterations'), /positive integer/);
  assert.throws(() => parseNumericBudget(21, 20, '--iterations'), /cannot exceed the contract limit/);
  assert.equal(usdToMicros(0.000001), 1);
  assert.equal(usdToMicros(1.2345675), 1234567);
  assert.equal(usdToMicros(1.2345675, 'ceil'), 1234568);
  assert.equal(usdToMicros(0.1 + 0.2), 300000);
  assert.equal(usdFromMicros(1500000), 1.5);
  assert.throws(() => usdToMicros(-1), /finite and non-negative/);
  assert.throws(() => usdToMicros(1e21), /safe accounting range/);
  assert.equal(remainingTokenBudget(null, 5), null);
  assert.equal(remainingTokenBudget(10, 4), 6);

  assert.equal(evaluateBudgetGate(budgetBase, 500).passed, true);
  const tokens = evaluateBudgetGate({ ...budgetBase, limits: { ...budgetLimits, max_tokens: 10 }, observed_tokens: 10 }, 500);
  assert.deepEqual([tokens.exhausted, tokens.metric, tokens.reason], [true, 'tokens', 'TOKEN_BUDGET_REACHED']);
  const usd = evaluateBudgetGate({ ...budgetBase, limits: { ...budgetLimits, max_usd: 1.5 }, observed_usd_micros: usdToMicros(1.5) }, 500);
  assert.deepEqual([usd.metric, usd.reason], ['estimated_usd', 'USD_LIMIT_REACHED']);
  assert.equal(evaluateBudgetGate(budgetBase, 1000).metric, 'wall_clock_ms');
  assert.equal(evaluateBudgetGate({ ...budgetBase, failed_candidates: 5 }, 500).reason, 'MAX_FAILED_CANDIDATES');
  assert.equal(evaluateBudgetGate({ ...budgetBase, consecutive_no_improvement: 3 }, 500).reason, 'MAX_CONSECUTIVE_NO_IMPROVEMENT');

  const noProcessControl = evaluateBudgetGate({ ...budgetBase, limits: { ...budgetLimits, max_tokens: 10 }, observed_tokens: 0, can_terminate_process_tree: false }, 500);
  assert.deepEqual([noProcessControl.reason, noProcessControl.exhausted], ['UNSUPPORTED_TOKEN_BUDGET_PROCESS_CONTROL', false]);
  const missingCounter = evaluateBudgetGate({ ...budgetBase, limits: { ...budgetLimits, max_tokens: 10 } }, 500);
  assert.deepEqual([missingCounter.passed, missingCounter.reason, missingCounter.missing], [false, 'GATE_INPUT_MISSING', ['observed_tokens']]);
  const unknownCost = evaluateBudgetGate({ ...budgetBase, limits: { ...budgetLimits, max_usd: 1 }, observed_usd_micros: 0, cost_total_unknown: true }, 500);
  assert.equal(unknownCost.reason, 'USD_USAGE_UNAVAILABLE');
});

// DoD 1 + 3 — the isolation gate compares pointer digests and refuses one-sided metadata.
// Reference implementation only: production calls `worktreeMetadataMatches` (`src/lib/git.ts`)
// and checks the opt-ins in `runner-preflight.ts` / `runner-candidate.ts`.
test('isolation gate (reference implementation, unwired) fails closed on worktree metadata and holdout opt-ins', () => {
  assert.equal(evaluateIsolationGate(isolationBase).passed, true);
  const changed = evaluateIsolationGate({ ...isolationBase, observed_metadata: { ...metadata, sha256: 'b'.repeat(64) } });
  assert.deepEqual([changed.passed, changed.reason, changed.metadata_restored], [false, 'WORKTREE_METADATA_CHANGED', true]);
  assert.equal(evaluateIsolationGate({ ...isolationBase, observed_metadata: null }).reason, 'WORKTREE_METADATA_CHANGED');
  assert.equal(evaluateIsolationGate({ ...isolationBase, expected_metadata: null }).reason, 'WORKTREE_METADATA_UNEXPECTED');
  const unreadable = evaluateIsolationGate({ ...isolationBase, observed_metadata: { path: '/w/.git', sha256: '' } });
  assert.deepEqual([unreadable.passed, unreadable.missing], [false, ['observed_metadata']]);
  assert.equal(evaluateIsolationGate({ ...isolationBase, adapter_requires_sandbox: true }).reason, 'SANDBOX_REQUIRED');
  assert.equal(evaluateIsolationGate({ ...isolationBase, holdout_ignored: true }).reason, 'PRIVATE_ORACLE_READABLE');
  assert.equal(evaluateIsolationGate({ ...isolationBase, holdout_ignored: false, readable_holdout_accepted: true }).reason, 'HOLDOUT_NOT_IGNORED');
});

// DoD 1 + 3 — the evidence gate recomputes the public verdict instead of trusting the bundle flag.
// Reference implementation only: production uses `allCasesPassed` / `casePassed` /
// `withinTolerance` (`gate/evidence.ts`) through `src/lib/evidence.ts`, and the verdict mapping
// is inlined in `src/lib/exec/runner-evaluate.ts`.
test('evidence gate and verdictForEvidence (reference implementation, unwired) recompute public pass and refuse unreadable objective scores', () => {
  const input = (baseline, candidate, overrides = {}) => ({ baseline, candidate, tolerance: 0, direction: 'maximize', min_delta: 0.01, ...overrides });
  const passing = evaluateEvidenceGate(input(objectiveBundle(0.5), objectiveBundle(0.6)));
  assert.deepEqual([passing.passed, passing.evidence_ok], [true, true]);
  assert.ok(Math.abs(passing.comparison.improvement - 0.1) < 1e-9);

  const inconsistent = evaluateEvidenceGate(input(objectiveBundle(0.5), { ...objectiveBundle(0.6), public: [caseSummary(false)] }));
  assert.deepEqual([inconsistent.passed, inconsistent.reason], [false, 'EVIDENCE_BUNDLE_INCONSISTENT']);
  assert.equal(evaluateEvidenceGate(input(objectiveBundle(0.5), evidenceBundle({ public: [caseSummary(false)], all_public_passed: false }))).reason, 'PUBLIC_TEST_FAILURE');
  const privateFailure = evaluateEvidenceGate(input(objectiveBundle(0.5), objectiveBundle(0.6, { private: { total: 1, passed: 0, failed: 1, cases: [{ case: 1, result: 'FAIL', exit_code: 1, passed: false, duration_ms: 1 }] } })));
  assert.equal(privateFailure.reason, 'HIDDEN_REGRESSION');
  const invalidScore = evaluateEvidenceGate(input(objectiveBundle(0.5), objectiveBundle(0.6, { objective: { ...caseSummary(true, 0.6), configured: true, valid_score: false } })));
  assert.deepEqual([invalidScore.reason, invalidScore.objective_valid], ['OBJECTIVE_SCORE_INVALID', false]);
  assert.equal(evaluateEvidenceGate(input(objectiveBundle(0.6), objectiveBundle(0.6001))).reason, 'NO_PRACTICAL_IMPROVEMENT');

  const missing = verdictForEvidence(evaluateEvidenceGate(undefined), { score: 0.1, band: 'LOW', reasons: [] });
  assert.deepEqual([missing.decision, missing.reason], ['QUARANTINE', 'GATE_INPUT_MISSING']);
  const high = verdictForEvidence(passing, { score: 0.8, band: 'HIGH', reasons: [] });
  assert.deepEqual([high.decision, high.reason], ['ESCALATE', 'HIGH_CHANGE_RISK']);
  assert.equal(verdictForEvidence(passing, null).reason, 'RISK_ASSESSMENT_MISSING');
  assert.equal(verdictForEvidence(passing, { score: 0.05, band: 'LOW', reasons: [] }).reason, 'ALL_REQUIRED_EVIDENCE_PASSED');
});

// DoD 1 — the path-policy and refusal-to-decision tables are independent entry points.
// Reference implementation only for `evaluatePolicyGate` / `decisionForCandidateCheck` /
// `verdictForRisk`: production uses `checkChangedPaths` (`gate/paths.ts`, wired via
// `src/lib/policy.ts`) and inlines the decision table in `src/lib/exec/runner-evaluate.ts`.
test('policy gate and candidate-check verdicts (reference implementation, unwired) keep the 0.3.0 mapping', async () => {
  const contract = await templateContract();
  const clean = evaluatePolicyGate({ contract, changed_paths: ['src/feature.js'] });
  assert.deepEqual([clean.passed, clean.violations], [true, []]);
  const dirty = evaluatePolicyGate({ contract, changed_paths: ['src/feature.js', 'test/gate.test.js'] });
  assert.deepEqual([dirty.passed, dirty.reason], [false, 'POLICY_VIOLATION']);
  assert.deepEqual(dirty.violations, [{ path: 'test/gate.test.js', category: 'protected_path' }]);
  assert.equal(decisionForCandidateCheck('CAPABILITY_VIOLATION'), 'ESCALATE');
  assert.equal(decisionForCandidateCheck('POLICY_VIOLATION'), 'QUARANTINE');
  assert.equal(decisionForCandidateCheck('EVIDENCE_MODIFIED_CANDIDATE'), 'QUARANTINE');
  assert.equal(decisionForCandidateCheck('UNDECLARED_CHANGE'), 'REJECT');
  assert.equal(verdictForRisk('CRITICAL').decision, 'QUARANTINE');
  assert.equal(verdictForRisk('HIGH').decision, 'ESCALATE');
  assert.equal(verdictForRisk('MEDIUM').decision, 'ACCEPT');
  assert.equal(verdictForRisk('LOW').reason, 'ALL_REQUIRED_EVIDENCE_PASSED');
});
