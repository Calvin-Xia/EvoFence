# EvoFence plugin for Claude Code

This native Claude Code plugin adds `/evofence:inspect-ledger` and `/evofence:run-evolution` commands. Claude Code scopes plugin commands with the plugin name, and the descriptive command names make their purpose clear in the command list. It does not add hooks or MCP servers. All changes and candidate acceptance remain governed by the EvoFence CLI contract and evidence gates.

## USD budgets

The Claude adapter supports `budgets.max_usd` when Claude supplies complete USD telemetry and the host can terminate the agent process tree. If process control is unavailable, preflight refuses with `UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL` and the message `This host cannot terminate the claude process tree. EvoFence refused to start a USD-budgeted run.` The alternative is to use a host that can terminate the process tree or set `budgets.max_usd` to `null`; do not treat that as an enforced USD budget.

## Install from GitHub

```text
/plugin marketplace add Calvin-Xia/EvoFence
/plugin install evofence@evofence
```

For local development, start Claude Code from the EvoFence checkout with:

```sh
claude --plugin-dir ./integrations/claude-code
```

Install EvoFence CLI in the environment where Claude Code runs. The run command requires an existing goal file. It will not automatically add `--allow-unisolated-agent` or `--allow-readable-holdout`; EvoFence will stop and report when an explicit boundary decision is required.
