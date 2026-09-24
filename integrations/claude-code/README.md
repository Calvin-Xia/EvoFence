# EvoFence plugin for Claude Code

This native Claude Code plugin adds `/evofence:inspect-ledger` and `/evofence:run-evolution` commands. Claude Code scopes plugin commands with the plugin name, and the descriptive command names make their purpose clear in the command list. It does not add hooks or MCP servers. All changes and candidate acceptance remain governed by the EvoFence CLI contract and evidence gates.

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
