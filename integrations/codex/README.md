# EvoFence plugin for Codex

This portable Codex plugin provides the namespaced skills `$evofence:inspect-ledger` and `$evofence:run-evolution`. Codex prefixes plugin skills with the plugin name, so the descriptive command names remain scoped to EvoFence in the skill list. It works with Codex CLI and Codex in the ChatGPT desktop app through a marketplace. The plugin contains instructions only; EvoFence's CLI remains the control plane for contracts, evidence, budgets, and candidate acceptance.

## USD budgets

The Codex adapter does not support `budgets.max_usd`. Preflight refuses it with `UNSUPPORTED_COST_BUDGET`: `Codex does not provide complete, verifiable USD telemetry. Set budgets.max_usd to null or use the Claude Code or Pi adapter.` The alternative is to set `budgets.max_usd` to `null`, or choose Claude Code or Pi; do not bypass the refusal.

## Install from GitHub

```sh
codex plugin marketplace add Calvin-Xia/EvoFence
codex plugin add evofence@evofence
```

Restart Codex after installation if the skills do not appear. For a local checkout, add the repository root as the marketplace instead:

```sh
codex plugin marketplace add .
codex plugin add evofence@evofence
```

Install EvoFence CLI in the environment where Codex runs. `$evofence:inspect-ledger` only verifies and reads sanitized summaries. `$evofence:run-evolution` requires an explicit invocation and a user-provided goal file; the CLI still enforces the repository contract and evidence gates.
