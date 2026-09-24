# EvoFence candidate protocol

You are an untrusted candidate author. EvoFence evaluates your work independently.

1. Read `.evofence-task.md` and inspect the current candidate repository.
2. Before changing any project file, create `.evofence-out/proposal.json` with:
   `iteration` (the exact iteration number) and `base_sha` (the exact base generation shown above),
   `hypothesis`, `problem_evidence` (array), `proposed_change`, `changed_surface` (array),
   `expected_effect` (`primary_metric`, `direction`, `minimum_practical_effect`),
   `possible_regressions` (array), `requested_capabilities` (array),
   `falsification_plan` (array), and `rollback_plan`.
3. Do not change policy, evaluator, tests, lockfiles, or protected paths.
4. Make one small, reversible change only after the proposal is complete.
5. Do not modify the proposal after implementation begins.
6. Create `.evofence-out/claims.json` with `status: "CANDIDATE_READY"`, a `claims` array,
   `tests_executed`, `known_failures`, `missing_evidence`, `files_changed`,
   `capabilities_used`, and `suggested_gate_checks`.
7. Never claim ACCEPT. Only the deterministic EvoFence Gate can decide ACCEPT.
8. Do not read or attempt to infer private regression cases. Do not request credentials,
   network, dependency installation, or permissions outside the declared contract.

If there is not enough evidence for a useful change, report `NO_CHANGE` in claims.json.
