# EvoFence plugin for OpenCode

This project-level plugin adds read-only tools for `evofence_doctor`, `evofence_verify_ledger`, `evofence_recent_runs`, and `evofence_verify_bundle`. It calls only the read-only EvoFence CLI surfaces; recent runs return curated summaries and omit prompts, commands, source, and evaluator output.

The tools invoke `evofence doctor --adapter opencode --json`, `evofence ledger verify`, `evofence ledger recent 10`, and `evofence ledger verify --bundle <file> --json` respectively.

## USD budgets

The OpenCode adapter does not support `budgets.max_usd`. Preflight refuses it with `UNSUPPORTED_COST_BUDGET`: `OpenCode reports cost without a verified currency; EvoFence cannot infer USD. Set budgets.max_usd to null or use the Claude Code or Pi adapter.` The alternative is to set `budgets.max_usd` to `null`, or choose Claude Code or Pi; do not infer USD from OpenCode's unverified cost value.

## Install in an OpenCode project

Copy this directory's `plugins/` folder, `package.json`, and `package-lock.json` into the target project's `.opencode/` directory, then install the pinned plugin dependency there:

```sh
mkdir -p .opencode
cp -R /path/to/EvoFence/integrations/opencode/plugins .opencode/plugins
cp /path/to/EvoFence/integrations/opencode/package.json .opencode/package.json
cp /path/to/EvoFence/integrations/opencode/package-lock.json .opencode/package-lock.json
npm ci --prefix .opencode
```

On Windows, copy the three paths with Explorer or PowerShell, then run `npm ci --prefix .opencode`. Install EvoFence CLI in the environment where OpenCode runs. OpenCode discovers project plugins in `.opencode/plugins/` at startup.
