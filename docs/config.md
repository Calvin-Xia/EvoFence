# The EvoFence config surface (v2)

EvoFence reads four YAML documents. They are parsed and validated by one v2 validator
(`src/lib/config/`), and the CLI fails closed on a document it cannot prove:

| Document | Path | Document code on failure |
| --- | --- | --- |
| Contract | `.evofence/contract.yaml` | `INVALID_CONTRACT` (a present-but-wrong `contract_version` keeps `UNSUPPORTED_CONTRACT`) |
| Adapter config | `.evofence/config.yaml` | `INVALID_CONFIG` |
| Private holdout | `.evofence/private/holdout.yaml` | `INVALID_HOLDOUT` |
| Experiment manifest | the file passed to `experiment run` | `INVALID_EXPERIMENT` |

Shared safety envelope: a policy file must be a regular file, not a symlink
(`UNSAFE_POLICY_FILE`), and must resolve inside the repository root (`PATH_ESCAPE`); duplicate
YAML keys are `INVALID_YAML`; a missing required file is `MISSING_FILE` (a missing holdout file
is the deliberate exception: it means "no private regressions configured").

## What "v2" means here

"v2" names the validation layer, not a new value for the YAML `version` field. `config.yaml`
still requires `version: 1`, and `contract.yaml` still requires `contract_version: 1`.

Two rules are the point of the layer:

1. **Unknown fields are rejected.** 0.3.0 had no `additionalProperties: false` semantics, so a
   mistyped key was silently ignored. v2 lists the offending path, for example
   `rejected field(s): budget_typo (Unknown field: budget_typo.)`. An unknown key inside an array
   entry is reported the same way, as in `regressions[0].enabled`; the open maps described below
   are the only places that stay permissive.
2. **Missing required fields are rejected**, reported as `missing field(s): ...`. They are never
   filled in.

## Required fields

The complete set of required paths (`required` in `src/lib/config/schema.ts`):

- `contract.yaml`: `contract_version`, `objective`, `objective.{name,command,direction,min_delta}`,
  `hard_invariants`, `allowed_evolution_surface`, `protected_paths`, `evidence`,
  `evidence.public_commands`, `acceptance`,
  `acceptance.{require_rollback_point,hidden_regression_tolerance}`, `capabilities`,
  `capabilities.authority_ceiling`, `budgets`,
  `budgets.{max_iterations,max_wall_clock_ms,max_failed_candidates,max_consecutive_no_improvement,max_tokens,max_usd}`
- `config.yaml`: `version`
- `holdout.yaml`: `regressions`
- experiment manifest: `goal_file`

## Code defaults (exactly two)

Only these two fields have a code-level fallback; absent means "use this value", and both copies
live in `CONTRACT_DEFAULTS`:

| Field | Code default |
| --- | --- |
| `evidence.per_command_timeout_ms` | `120000` |
| `evidence.max_output_bytes` | `1048576` |

Values in `templates/contract.yaml` are **template** values. They exist only after
`evofence init` copies the file, and they never rescue an absent key. Do not add `??` fallbacks
for any other field: that would turn a fail-closed refusal into a silent default.

## Open maps vs. closed maps

- `capabilities` is the one open map (`open: true`): `assessCapabilities` indexes it by the
  capability name a proposal requests, so an unknown key there is a capability name, not a typo.
- `adapters` is closed: only the four known adapter names are read, and v2 rejects an unknown one
  (`rejected field(s): adapters.gemini`).

## Keys that are not gates

Several keys appear in `templates/contract.yaml` but do not act as gates. They are documented so
they cannot be mistaken for effective controls; `src/lib/gate/dead-keys.ts` is the
machine-readable registry and a test pins that a permissive value changes no judgement.

| Key | Status | What it actually does |
| --- | --- | --- |
| `acceptance.require_proposal` | **not a gate** | Zero code references. Proposal validation runs unconditionally in `checkProposal`. |
| `acceptance.require_claims` | **not a gate** | Zero code references. Claims validation runs unconditionally in `checkClaims`. |
| `capabilities.shell.mode` | **not a gate** | Zero code references. The only shell capability is the hardcoded builtin `shell:evidence_commands_only` grant. |
| `capabilities.authority_ceiling` | validated only | Accepted as `A0`–`A3` (and `A4` is rejected), but no decision consults it. |
| `capabilities.network` | task file only | Echoed into `.evofence-task.md` by `taskContents`; blocks nothing. |
| `capabilities.dependency_install` | task file only | Same. |
| `capabilities.credentials` | task file only | Same. |
| `capabilities.external_api` | **live gate** | Read through the dynamic capability table (`contract.capabilities[capability]`), so a proposal that requests `external_api` is judged by this value. The template sets it to `deny`, which denies the request. |

`assessCapabilities` treats a capability as granted only when the configured value is `true`,
`'allow'`, or an object with `mode: 'allow'`. An unconfigured capability is denied.

## Where validation runs

- `evofence init` validates the scaffold it wrote, so it cannot leave a repository whose own
  `contract.yaml` / `config.yaml` the next command would refuse.
- `evofence status` validates both policy files and echoes a `policy` block. An invalid file
  fails `status` with the configuration code (`INVALID_CONTRACT` / `INVALID_CONFIG` /
  `UNSUPPORTED_CONTRACT`) and exit code 1; an absent file stays tolerable, so a repository without
  `.evofence/` state still has a status.
- Every path that reads a policy document from disk goes through `src/lib/config/`. `run` and
  `experiment run` load the contract and `config.yaml` through `loadRequiredContractDocumentSync` /
  `loadRequiredConfigDocumentSync` before dispatching an agent, `evidence run` loads the same pair
  for a manual check, and the private holdout goes through `validatePolicyFileSync('holdout')`
  inside `loadPrivateHoldout` (`src/lib/contract.ts`). An unknown or missing key is therefore
  refused on the run paths exactly as `init` and `status` refuse it, from one validator for the
  four documents. An absent holdout stays `[]`: no private oracle configured is not an error.
- `validateContract` (`src/lib/gate/contract-document.ts`) stays the pure, in-memory 0.3.0 value
  checker behind the public export. It has no `additionalProperties: false` semantics and no longer
  reads files, so it is not the gate that rejects a typo.

## Configuration surface guard

Run `npm run config:doc` to compare the machine-readable configuration surface from the built
`src/lib/config/` exports with this document. `src/lib/config/schema.ts` remains the source of
truth; the guard does not reimplement runtime validation or add a runtime default.

The guard checks the failure-code table, every required path, the two code-default paths and
values, the unknown-field and missing-field rules, and the open/closed map rules. It reports the
document kind, field path, and relevant section for additions, removals, renames, or value drift.
A non-zero exit means that this document no longer describes the shipped schema and must be
updated together with the schema change. The guard does not replace `evofence status` validation.

To check a document by hand, run `evofence status` and read the reported paths, or add
`--json` to get `details.rejected_fields` / `details.missing_fields`.

## budgets.max_usd

`budgets.max_usd` is a run-wide estimated USD budget. A non-null value is supported by Claude
Code and Pi, but the enforcement semantics differ:

- Claude Code receives the remaining budget through its native `--max-budget-usd` option and
  reports the complete `result.total_cost_usd` estimate.
- Pi has no request-time hard cap. After each invocation, EvoFence requires complete USD
  telemetry from Pi's model-price estimate, adds it through the existing micros accounting path,
  and stops later invocations when the run-wide threshold is reached.
- Codex remains rejected because it does not report complete verifiable USD telemetry. OpenCode
  remains rejected because its reported cost has no verified currency; EvoFence must not infer
  that it is USD.

The response that reaches the threshold may already have completed, so the observed estimate can
exceed `max_usd`; that value is not the provider's final bill. Missing or incomplete cost,
timeouts, or unconfirmed process-tree termination fail closed and stop before candidate
evaluation or acceptance. Claude's native cap and Pi's post-invocation estimate are therefore
reported as different paths, not as the same kind of hard limit.
