import { EvoFenceError, invariant } from './errors.js';

const BUILTIN_PROTECTED = [
  '.git/**',
  '.evofence/**',
  '.evofence-task.md',
  'test/**',
  'tests/**',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test_*.py',
  '**/*_test.py',
  '**/*_test.go',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock*',
  '.github/workflows/**',
];

function globRegex(glob) {
  let source = '^';
  const pattern = glob.replaceAll('\\', '/').replace(/^\.\//, '');
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

export function matchesGlob(filename, pattern) {
  const name = filename.replaceAll('\\', '/').replace(/^\.\//, '');
  return globRegex(pattern).test(name);
}

export function isProtectedPath(filename, contract) {
  return [...BUILTIN_PROTECTED, ...contract.protected_paths].some((pattern) => matchesGlob(filename, pattern));
}

export function isAllowedPath(filename, contract) {
  if (!contract.allowed_evolution_surface.length) return true;
  return contract.allowed_evolution_surface.some((pattern) => matchesGlob(filename, pattern));
}

export function checkChangedPaths(paths, contract) {
  const violations = [];
  for (const filename of paths) {
    if (isProtectedPath(filename, contract)) {
      violations.push({ path: filename, category: 'protected_path' });
    } else if (!isAllowedPath(filename, contract)) {
      violations.push({ path: filename, category: 'outside_evolution_surface' });
    }
  }
  return violations;
}

export function checkProposal(proposal) {
  invariant(proposal && typeof proposal === 'object' && !Array.isArray(proposal), 'INVALID_PROPOSAL', 'proposal.json must contain an object.');
  invariant(Number.isInteger(proposal.iteration) && proposal.iteration >= 1, 'INVALID_PROPOSAL', 'proposal.iteration must be a positive integer.');
  invariant(typeof proposal.base_sha === 'string' && /^[0-9a-f]{40,64}$/i.test(proposal.base_sha), 'INVALID_PROPOSAL', 'proposal.base_sha must be a full git commit SHA.');
  invariant(typeof proposal.hypothesis === 'string' && proposal.hypothesis.trim(), 'INVALID_PROPOSAL', 'proposal.hypothesis is required.');
  invariant(typeof proposal.proposed_change === 'string' && proposal.proposed_change.trim(), 'INVALID_PROPOSAL', 'proposal.proposed_change is required.');
  invariant(Array.isArray(proposal.problem_evidence) && proposal.problem_evidence.length > 0 && proposal.problem_evidence.every((item) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.problem_evidence must contain observed evidence strings.');
  invariant(Array.isArray(proposal.changed_surface) && proposal.changed_surface.every((item) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.changed_surface must be an array of path strings.');
  invariant(Array.isArray(proposal.possible_regressions) && proposal.possible_regressions.every((item) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.possible_regressions must be an array of strings.');
  invariant(Array.isArray(proposal.requested_capabilities) && proposal.requested_capabilities.every((item) => typeof item === 'string' || (item && typeof item === 'object')), 'INVALID_PROPOSAL', 'proposal.requested_capabilities must contain capability names or request objects.');
  invariant(Array.isArray(proposal.falsification_plan) && proposal.falsification_plan.length > 0 && proposal.falsification_plan.every((item) => typeof item === 'string'), 'INVALID_PROPOSAL', 'proposal.falsification_plan must contain at least one string check.');
  invariant(typeof proposal.rollback_plan === 'string' && proposal.rollback_plan.trim(), 'INVALID_PROPOSAL', 'proposal.rollback_plan is required.');
  invariant(proposal.expected_effect && typeof proposal.expected_effect === 'object', 'INVALID_PROPOSAL', 'proposal.expected_effect is required.');
  invariant(typeof proposal.expected_effect.primary_metric === 'string' && proposal.expected_effect.primary_metric.trim(), 'INVALID_PROPOSAL', 'expected_effect.primary_metric is required.');
  invariant(['increase', 'decrease'].includes(proposal.expected_effect.direction), 'INVALID_PROPOSAL', 'expected_effect.direction must be increase or decrease.');
  invariant(typeof proposal.expected_effect.minimum_practical_effect === 'string' && proposal.expected_effect.minimum_practical_effect.trim(), 'INVALID_PROPOSAL', 'expected_effect.minimum_practical_effect is required.');
  return proposal;
}

export function checkClaims(claims) {
  invariant(claims && typeof claims === 'object' && !Array.isArray(claims), 'INVALID_CLAIMS', 'claims.json must contain an object.');
  invariant(['CANDIDATE_READY', 'NO_CHANGE', 'BLOCKED'].includes(claims.status), 'INVALID_CLAIMS', 'claims.status must be CANDIDATE_READY, NO_CHANGE, or BLOCKED.');
  invariant(Array.isArray(claims.claims), 'INVALID_CLAIMS', 'claims.claims must be an array.');
  invariant(Array.isArray(claims.tests_executed), 'INVALID_CLAIMS', 'claims.tests_executed must be an array.');
  invariant(Array.isArray(claims.known_failures), 'INVALID_CLAIMS', 'claims.known_failures must be an array.');
  invariant(Array.isArray(claims.missing_evidence), 'INVALID_CLAIMS', 'claims.missing_evidence must be an array.');
  invariant(Array.isArray(claims.files_changed) && claims.files_changed.every((item) => typeof item === 'string'), 'INVALID_CLAIMS', 'claims.files_changed must be an array of paths.');
  invariant(Array.isArray(claims.capabilities_used), 'INVALID_CLAIMS', 'claims.capabilities_used must be an array.');
  invariant(Array.isArray(claims.suggested_gate_checks), 'INVALID_CLAIMS', 'claims.suggested_gate_checks must be an array.');
  return claims;
}

export function assessRisk(paths, proposal, contract) {
  const reasons = [];
  let score = 0.05;
  if (paths.length > 20) {
    score += 0.35;
    reasons.push('large_change_surface');
  } else if (paths.length > 8) {
    score += 0.2;
    reasons.push('broad_change_surface');
  } else if (paths.length > 3) {
    score += 0.1;
    reasons.push('multi_file_change');
  }

  const requested = proposal?.requested_capabilities ?? [];
  if (requested.length > 0) {
    score += 0.3;
    reasons.push('capability_request_requires_escalation');
  }
  if (paths.some((name) => /(^|\/)(auth|security|permissions?|policy|workflow)(\/|\.|$)/i.test(name))) {
    score += 0.35;
    reasons.push('security_or_policy_surface');
  }
  if (paths.some((name) => /(^|\/)(test|tests)(\/|$)|\.(test|spec)\.[^.]+$/i.test(name))) {
    score += 1;
    reasons.push('test_surface_changed');
  }
  if (proposal?.expected_effect?.primary_metric && proposal.expected_effect.primary_metric !== contract.objective.name) {
    score += 0.15;
    reasons.push('proposal_metric_mismatch');
  }
  score = Math.min(1, Math.round(score * 100) / 100);
  return { score, band: score < 0.3 ? 'LOW' : score < 0.65 ? 'MEDIUM' : score < 0.9 ? 'HIGH' : 'CRITICAL', reasons };
}

export function assessCapabilities(proposal, contract) {
  const requests = proposal?.requested_capabilities ?? [];
  if (!requests.length) return { allowed: true, requests: [] };
  const results = requests.map((request) => {
    const capability = typeof request === 'string' ? request : request?.capability;
    const configured = contract.capabilities[capability];
    const allowed = configured === true || configured === 'allow' || configured?.mode === 'allow';
    return { capability: capability ?? 'unknown', allowed, scope: request?.scope ?? request?.exact_scope ?? null, reason: allowed ? 'policy_allow' : 'not_allowed_by_contract' };
  });
  return { allowed: results.every((item) => item.allowed), requests: results };
}

export function requireEvidenceConfigured(contract) {
  if (!contract.hard_invariants.length && !contract.evidence.public_commands.length) {
    throw new EvoFenceError('NO_EVIDENCE_CONFIGURED', 'Add at least one hard invariant or public evidence command to .evofence/contract.yaml before running an evolution loop.');
  }
  if (contract.acceptance.require_objective_improvement && !contract.objective.command.trim()) {
    throw new EvoFenceError('OBJECTIVE_NOT_CONFIGURED', 'Set objective.command to a trusted command that prints a numeric score before running the evolution loop.');
  }
}
