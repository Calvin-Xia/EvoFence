# EvoFence contributor notes

## Project

EvoFence is an experimental Node.js control plane for evidence-gated coding-agent evolution. It runs candidate changes in Git worktrees and accepts them only after configured checks and objectives pass.

## Development

- Requires Node.js 22.13 or newer and Git 2.42 or newer, and uses native ESM.
- Install dependencies with `npm ci`.
- The source is TypeScript under `src/`. The runtime and the only published artifact are the `tsc` output in `dist/` (ADR-0002); `package.json` points `bin.evofence` at `dist/cli.js` and `exports["."]` / `types` at `dist/index.js` / `dist/index.d.ts`.
- Tests import `dist/**`, not `src/**` (ADR-0004), so `npm test` and `npm run test:e2e` build first. Never read a stale `dist/` as a test result.
- Commands:
  - `npm run build` — `tsc`; emits `dist/**/*.js`, `*.d.ts`, `*.d.ts.map`, `*.js.map`.
  - `npm run typecheck` — `tsc --noEmit`.
  - `npm run dep:check` — acyclic dependency check over `src/` (`acyclic: true`).
  - `npm test` — build, then `node --test` over `test/**`.
  - `npm run test:e2e` — build, then `test-e2e/cli-flow.mjs`.
  - `npm run check` — `typecheck` + `dep:check` + `test`. This is the project gate.
- Keep generated state, local ledgers, private holdouts, and credentials out of Git.

## Structure and boundaries

- `src/` is split by domain; dependencies point one way and `npm run dep:check` enforces acyclicity:
  - `src/types/` — the shared type contract. Imports only other `src/types/` modules; never `src/lib/**`.
  - `src/lib/gate/` — contract, evidence, policy/paths, risk, capability, budget and isolation judgement. Judgement only, no orchestration.
  - `src/lib/ledger/` — ledger schema (v2), hash chain, queries, summaries, SQLite driver.
  - `src/lib/exec/` — runner and adapter orchestration, process control, budget accounting, worktree/temp handling.
  - `src/lib/config/` — the v2 config surface (`schema` → `fields` → `validate` → `load`) for the four `.evofence` YAML documents.
  - `src/lib/cli/` — command catalog (`catalog.ts` is the manifest), argv parsing, handlers, output/failure contract.
  - `src/lib/report/` — the shared JSON views behind `report`, `status` and `diff`.
  - The remaining `src/lib/*.ts` files (`runner.ts`, `ledger.ts`, `contract.ts`, `policy.ts`, `audit.ts`, `report.ts`, `status.ts`, `adapter.ts`, `process.ts`, `git.ts`, `init.ts`, …) are the R1-stable entry points kept as facades over their domain.
- `test/` uses Node's built-in test runner against `dist/**`; `test-e2e/` holds the CLI flow suite; `scripts/` holds the dependency and release-metadata checks.
- `docs/refactor-inventory.md`, `docs/refactor-inventory-review.md`, `docs/refactor-l2-protocol.md`, `docs/refactor-dispatch.md`, `docs/refactor-final-review.md` and `docs/test-coverage-map.md` are historical process records. They describe the 0.3.0 baseline or the refactor that produced 0.4.0, not current behavior; keep them frozen and do not treat them as the source of truth for the shipped CLI, config or ledger format. `docs/config.md` and `docs/pi-tool-strategy.md` describe current behavior.
- The 0.4.0 topology lives in `.graph/` ([Super Plumber](https://github.com/LUKAWI/super-plumber)): nodes, edges, the five ADRs and the append-only `events.jsonl` audit log. It is **gitignored on purpose** — it is the process state that drove the refactor, not product source, and most of its bulk is auto-generated per-mutation snapshots. No code under `src/` may read it, and no npm script or CI job may require the `graph` CLI.
- The root `CONTEXT-MAP.md` and `DECISIONS.md` plus `docs/adr/`, `docs/contexts/` and `docs/topology.mmd` are **exported views** of that graph, and they ARE tracked: they are the readable record for everyone who does not have the graph. Do not hand-edit them — whoever holds the graph re-exports (`graph export --docs`), and `graph export --docs --check` reports drift for exactly that reason. Node status moves only through the graph CLI/MCP or `sp.mjs`: never hand-edit a node YAML to fake a transition.
- `integrations/` contains agent adapters and native plugins. A plugin's available tools are not the same thing as an `evofence run --adapter ...` adapter.
- Keep plugin inspection read-only unless a separately documented, explicit command delegates to the EvoFence CLI.
- Preserve contract, evidence, budget, and isolation gates. Do not claim worktree isolation is an OS sandbox.

## Breaking contracts to respect

- **CLI surface**: `src/lib/cli/catalog.ts` is the manifest — every subcommand, flag, JSON mode and exit code, with the smoke invocation that pins it. `--json` is accepted by every command; in `--json` mode stdout stays empty and a failure prints one `{"error":{"code","message","details"?}}` object on stderr. Exit codes are only `0` and `1`. Unknown flags are usage errors, and `--flag=value` is accepted. `--help` is generated from the manifest: do not hand-maintain a second command list.
- **Config v2**: `.evofence/contract.yaml`, `.evofence/config.yaml`, `.evofence/private/holdout.yaml` and the experiment manifest go through `src/lib/config/`. Unknown fields and missing required fields are rejected. Exactly two fields have code defaults (`evidence.per_command_timeout_ms`, `evidence.max_output_bytes`); never add another `??` fallback. The YAML `version` / `contract_version` values are still `1` — "v2" names the validator layer. `init` and `status` validate policy files and fail closed.
- **Ledger schema v2**: `src/lib/ledger/schema.ts`. A 0.3.0 ledger is refused with `LEDGER_SCHEMA_INCOMPATIBLE` before any pragma or DDL, with no migration; `status` reports it as `LEDGER_UNAVAILABLE` with the same explanation. The hash-chain recipe, DDL, triggers and write order must not change silently.
- **Non-gates**: `acceptance.require_proposal`, `acceptance.require_claims` and `capabilities.shell.mode` are template-only keys with no runtime effect (`src/lib/gate/dead-keys.ts`). `capabilities.authority_ceiling` is validated only; `capabilities.network` / `dependency_install` / `credentials` are echoed into `.evofence-task.md` only. `capabilities.external_api` is a live capability gate. Document them as such — never as effective gates.

## Current status and next step

The package is a prerelease research MVP. Check `CHANGELOG.md`, the active pull requests, and their CI before describing current release status. Do not create a release tag or publish to npm without explicit user authorization.
