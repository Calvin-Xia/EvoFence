# Changelog

## 0.4.1 — 2026-09-29

**Non-breaking.** Two new capabilities, one budget extension, two machine guards and one bug fix.
No existing contract changes: every 0.4.0 command, flag, exit code and on-disk format behaves as
before.

### New: `evofence doctor [--adapter <name>] [--json]`

A read-only preflight that presents the same pre-dispatch judgements `run` already applies (policy
validity, evidence configuration, holdout exposure and Git-ignore, budget/adapter compatibility,
adapter isolation, process-tree capability, ledger integrity), so an environment problem surfaces
before an agent spends budget.

It introduces **no separate health-check rules**: the pre-dispatch policy now lives in one module
(`src/lib/exec/preflight-policy.ts`) that `run` and `doctor` both call, so the two cannot drift
apart. This was not a cosmetic choice — an earlier revision duplicated the `prepareRun` conditions
and reported a *false* `UNSUPPORTED_COST_BUDGET` refusal for a `pi` + `max_usd` configuration that
`run` accepts. Independent review caught it; the shared module is the fix, locked by
cross-assertion tests that compare `doctor` against `run` on the same fixtures.

All checks pass → exit 0. Any refusal → exit 1, and under `--json` a refusal follows the CLI
failure contract: empty stdout, one `{"error":...}` object on stderr carrying the checks in
`details`.

### New: `ledger verify --bundle <file>`

Verifies an exported ledger bundle **offline**: it recomputes the frozen SHA-256 chain recipe over
the bundle's events and compares the result with the bundle's recorded `integrity`. Exported
evidence can therefore be checked on a host that does not hold the local database — something no
previous surface could do.

The verifier additionally rejects a bundle whose parsed `payload` diverges from the hashed
`payload_json` (`LEDGER_BUNDLE_PAYLOAD_MISMATCH`, naming the first offending sequence), and maps
malformed bundle JSON to a coded error rather than a bare `SyntaxError` (`code: null`). Without the
first check a forged `payload` would still verify, which would defeat the point of the command.

### `budgets.max_usd` now supports the Pi adapter

Pi reports complete USD model-price estimates, so it joins Claude Code as a USD-budgeted adapter.
Pi accumulates cost after each invocation and stops at the run-wide threshold; it is **not** a
request-time hard cap, and the crossing response may put the estimate over the threshold. This is
an estimate, not the provider's final bill. Claude Code continues to use its native
`--max-budget-usd` cap. Codex (no complete USD telemetry) and OpenCode (cost reported without a
verified currency) stay rejected before launch whenever `max_usd` is non-null.

### New: the documented configuration surface is machine-guarded

`docs/config.md` declared its list of required paths complete while nothing verified it. A
zero-dependency script now solves the required paths, the two code defaults, the per-document
failure codes, the `UNSUPPORTED_CONTRACT` exception and the open/closed map boundaries from
`src/lib/config/schema.ts`, and fails CI on any drift. It runs as its own `npm run config:doc` CI
step — deliberately not folded into `npm run check`.

### Fixed

- **`stderr` was polluted on Node ≥ 23.5.** `runProcess` passed a non-empty argv together with
  `shell: true`, a combination Node deprecates. The child emitted a `DEP0190` warning onto the
  parent's `stderr`, breaking the contract that a failing `--json` run prints exactly one error
  object there. The argv is now folded into the command line under shell mode, preserving the exact
  command semantics; a regression test asserts both the clean `stderr` and the unchanged semantics.

### Docs

- Exported graph views for this round's topology: `docs/evofence-ops-evidence/` — `CONTEXT-MAP.md`,
  `DECISIONS.md`, four context documents and four ADRs. The 0.4.0 views at the repository root are
  unchanged.
- `AGENTS.md` command list corrected (adds `src:policy` and `config:doc`, and records that
  `npm run check` does not include `config:doc`); `docs/topology.mmd` regenerated.

## 0.4.0 — BREAKING

A breaking refactor of the 0.3.0 codebase: the source language, the published shape, the CLI
command surface, the config validator and the ledger on-disk format all change. There is no
feature work beyond what is listed below.

### ① Source is TypeScript; the release shape is `dist/` only

- All of `src/` is now TypeScript. The 0.3.0 `.js` sources are gone and the runtime and published
  artifact is the `tsc` output in `dist/` (ADR-0002).
- `package.json` publishes `dist/` plus `templates/`, `README.md`, `README.en.md`, `CHANGELOG.md`,
  `LICENSE` and `docs/pi-tool-strategy.md`. `bin.evofence` is `dist/cli.js`; `exports["."]` and
  `types` resolve to `dist/index.js` / `dist/index.d.ts` (0.3.0 published `src/index.js` and
  `src/cli.js` directly).
- The build emits declarations and maps (`dist/**/*.d.ts`, `*.d.ts.map`, `*.js.map`), so consumers
  get real types for the same public API — the 18 symbols re-exported from `src/index.ts`.
- Scripts: `npm run build` (`tsc`), `npm run typecheck` (`tsc --noEmit`), `npm run dep:check`
  (acyclic dependency check over `src/`), `npm test` (**builds first**, then `node --test`),
  `npm run test:e2e` (builds first, then the CLI flow suite) and `npm run check` (typecheck +
  dep:check + test). Tests import the build output under `dist/`, not `src/` (ADR-0004).

### ② CLI command-surface redesign (ADR-0003)

- The eleven 0.3.0 groups are kept (`init`, `run`, `proposal`, `evidence`, `gate`, `ledger`,
  `diff`, `rollback`, `experiment`, `report`, `status`) and the flag/JSON/exit conventions inside
  them are unified around one manifest (`src/lib/cli/catalog.ts`).
- `--json` is accepted by **every** subcommand. 0.3.0 honoured it only on `run`, `diff`, `report`
  and `status`; `init`, `rollback`, `ledger export` and `experiment export` gained a JSON view.
- In `--json` mode a failure prints ONE `{"error":{"code","message","details"?}}` object on
  stderr and leaves stdout empty. Text mode keeps the 0.3.0 `[CODE] message` line on stderr.
- Unknown flags are now rejected everywhere. 0.3.0 silently ignored an unknown value flag on
  `run` (`--foo bar`) and swallowed stray arguments on `init`/`proposal` as positional noise.
- `--flag=value` is accepted in addition to `--flag value`.
- `evidence run <dir> --json` is now accepted (0.3.0 treated `--json` as a third positional and
  failed with `USAGE`); the command already printed JSON, so this only makes the flag legal.
- Exit codes are frozen at `0` (success) and `1` (any failure) and are declared per command
  instead of being emergent; `evofence --help` is generated from the same manifest as the
  dispatcher, so the command list can no longer drift from the implementation.

### ③ Config v2: strict validation, unknown and missing fields rejected

- `.evofence/contract.yaml`, `.evofence/config.yaml`, `.evofence/private/holdout.yaml` and the
  `experiment run` manifest go through one v2 validator (`src/lib/config/`).
- **Unknown fields are rejected** with the offending paths listed
  (`INVALID_CONTRACT` / `INVALID_CONFIG` / `INVALID_HOLDOUT` / `INVALID_EXPERIMENT`). 0.3.0 had no
  `additionalProperties: false` semantics, so a mistyped key such as `budget:` was silently
  ignored.
- **Missing required fields are rejected** and reported as `missing field(s): ...`. The whole
  config surface has exactly two code defaults — `evidence.per_command_timeout_ms` (120000) and
  `evidence.max_output_bytes` (1048576). Values in `templates/contract.yaml` stay template values;
  they are not runtime fallbacks.
- `evofence init` validates the scaffold it just wrote, and `evofence status` validates both policy
  files: an invalid `contract.yaml` / `config.yaml` now fails `status` with exit code 1
  (`INVALID_CONTRACT` / `INVALID_CONFIG`) instead of being ignored, and those codes survive the CLI
  wrapper.
- The YAML version fields are unchanged: `config.yaml` still requires `version: 1` and
  `contract.yaml` still requires `contract_version: 1`. "v2" names the validator layer, not a new
  value for those keys.
- Documented non-gates (unchanged from 0.3.0): `acceptance.require_proposal`,
  `acceptance.require_claims` and `capabilities.shell.mode` are template-only keys with zero code
  references (`src/lib/gate/dead-keys.ts`). `capabilities.authority_ceiling` is validated (A0–A3)
  but consulted by no decision, and `capabilities.network` / `dependency_install` / `credentials`
  are only echoed into `.evofence-task.md`. `capabilities.external_api` **is** a live capability
  gate, resolved through the dynamic capability table.

### ④ Ledger schema v2 — BREAKING, no migration

- The ledger now declares schema v2 in the `state` table (the `schema_version` key). The hash-chain
  recipe, the DDL, the pragmas, the append-only triggers, the table set and the write order are
  unchanged from 0.3.0.
- **0.3.0 ledgers are not readable and are never converted.** Opening one fails with
  `LEDGER_SCHEMA_INCOMPATIBLE`; the refusal happens before any pragma or DDL runs, so the old
  database is left untouched. `ledger show` / `ledger verify` / `ledger recent` / `diff` /
  `rollback` / `run` surface `LEDGER_SCHEMA_INCOMPATIBLE` (exit 1); `status` reports
  `LEDGER_UNAVAILABLE` with a message naming the observed (v1) format.
- No migration, upgrade or downgrade path is provided, and none is planned in this release
  (adr_0001).

### ⑤ Upgrading 0.3.0 → 0.4.0

1. Reinstall: `npm install --global --allow-scripts=better-sqlite3 evofence`, or `npm ci` in a
   checkout. The package now ships `dist/`.
2. **Back up or discard `.evofence/ledger.sqlite`.** 0.4.0 cannot read it. Move it aside (for
   example to `.evofence/ledger.sqlite.v1.bak`) and run `evofence init` to create a fresh v2
   ledger. Old history remains available only in the old build; it is not carried forward.
3. Re-check `.evofence/contract.yaml` and `.evofence/config.yaml` against the v2 validator. Run
   `evofence status`: it prints the exact rejected and missing field paths and exits 1. Remove
   unknown keys and add the reported missing fields.
4. Audit scripts and CI that call the CLI. `--json` is now global, unknown flags are hard errors,
   and in `--json` mode failures put one JSON object on stderr with stdout empty.
5. Update anything that imports the package: the runtime entry moved from `src/index.js` to
   `dist/index.js`. The 18 public symbols are unchanged, but only the `dist/` build is shipped.
6. If you relied on `acceptance.require_proposal`, `acceptance.require_claims` or
   `capabilities.shell.mode` as gates, stop: they never took effect and still do not.

## 0.3.0

- Add `evofence diff <generation-id> [--json]`, a generation audit view backed by `src/lib/audit.js`: it verifies the ledger hash chain and cross-checks the generation row against its hash-chained `generation.accepted` / `candidate.accepted` records first (failing with `LEDGER_CORRUPT`), reports a generation's changed paths, unified diff (capped at 200 KiB, marked in text output when truncated), objective delta, and the gate evidence that accepted it without embedding evidence output content, recomputes `diff_sha256` from Git with diff attributes pinned to the generation tree (Git 2.42+ required; older Git fails clearly) and flags disagreements with the recorded `diff_sha256_recorded` via `diff_sha256_matches`, binds the displayed evidence, proposal, objective score and improvement to the acceptance record's `evidence_artifact` / `proposal_sha256` links and recomputed gate evidence (proposal digests rehashed against content, improvement baseline derived from validated prior evidence chained to the accepted parent), requires a unique preceding ACCEPT gate decision and gate-passed bound and baseline evidence (valid score and improvement meeting the contract min_delta), rejects ambiguous duplicate acceptance, proposal, evidence or baseline records, and never accepts records appended after the acceptance as its gate, proposal, baseline or contract, and binds every linked record's base_sha to the accepted parent (legacy records without those links keep the run/iteration fallback), and labels generations without acceptance evidence as not accepted.
- Add `evofence report [file] [--json]`, an evolution report exporter backed by `src/lib/report.js`: it summarizes runs, accepted generations, objective delta, budget observations, and ledger integrity as Markdown or JSON.
- Add `evofence status [--json]`, a one-screen operational overview backed by `src/lib/status.js`: active generation with sha, ledger integrity, four cumulative totals, and the five most recent runs.
- Create the ledger database during `evofence init`, and make `evofence status` tolerate degenerate ledgers: missing, zero-byte, or schema-less ledger files render as the documented empty state while a partially missing schema is reported as an unreadable ledger, malformed or non-object payloads keep the FAILED integrity presentation instead of crashing payload aggregation, and the command exits 1 when integrity fails or the ledger cannot be read.

## 0.2.1

- Add a Pi CLI tool strategy that selects active read-only tools for proposal phases, orders tools by phase, and adapts within each phase to tool-call feedback without adding tools or permissions.
- Make the DeepSeek Harness Cordis bundle discoverable as an EvoFence monorepo subpath, declare exact tested compatibility and license metadata, and document its read-only permissions and native dependency install step.

## 0.2.0

- Add Codex CLI/desktop and Claude Code plugins, plus read-only OpenCode, Pi, and DeepSeek Harness Cordis integrations. Pi auto-loads from the project's `.pi/extensions/` directory when run in this checkout.
- Add Claude Code and Pi CLI adapters with token/cost telemetry and run-wide budget enforcement. Require explicit opt-in for unsandboxed adapters and fail closed when complete usage is unavailable.
- Add fail-closed Codex/OpenCode token-budget cutoffs with complete streamed-event accounting, including OpenCode reasoning tokens.
- Add sanitized recent-run summaries that count rejected iterations once and infer iteration counts for failed runs.
- Expand CI coverage to Windows and Node 22/24; add release metadata checks and GitHub Actions Trusted Publishing support.

## 0.1.1

- Strip common token, API/access/private-key, secret, password, credential, and authentication-helper environment variables from child processes.
- Recheck candidate paths and content after evidence commands; include new files in accepted-generation hashes.
- Correct output truncation reporting and allow claims for capabilities approved by the contract.

## 0.1.0

- Initial research MVP: repository initialization, isolated Git candidates, Codex/OpenCode
  adapters, deterministic evidence gate, SQLite audit ledger, generation rollback, and
  JSON experiment export.
