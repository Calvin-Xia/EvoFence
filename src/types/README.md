# `src/types` — shared type contract layer

Import from `../types/index.js`; use a submodule only when one domain suffices: `shared` (primitives, `AdapterName`), `config` (`.evofence/*.yaml`, v2 validation envelope), `ledger` (event rows, hash chain, read views), `proposal` (`proposal.json`/`claims.json` + the checks on them), `evidence` (per-command results, bundles, objective delta), `gate` (four gates, risk, verdicts), `exec` (process/adapter results, usage accounting, worktree metadata), `report` (`report`/`status`/`diff` JSON views).

Dependency discipline: this layer imports **nothing** but other `src/types/**` modules — no `better-sqlite3`, no `yaml`, no `src/lib/**`, no runtime code. Edges run `shared <- config/ledger/exec/proposal <- evidence <- gate`, plus `report <- ledger`; it is only ever depended upon, never a depender, and `npm run dep:check` enforces acyclicness across all of `src/`.

Add a type only when it is genuinely shared by two or more L2 domains — a single-domain shape belongs in that domain, and renaming anything here breaks four parallel worktrees.

Every type is derived from the 0.3.0 source (each file header names its sources and `docs/refactor-inventory.md` sections); never design a new runtime shape at this layer.
