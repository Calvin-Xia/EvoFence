# EvoFence contributor notes

## Project

EvoFence is an experimental Node.js control plane for evidence-gated coding-agent evolution. It runs candidate changes in Git worktrees and accepts them only after configured checks and objectives pass.

## Development

- Requires Node.js 22.13 or newer and uses native ESM.
- Install dependencies with `npm ci`; run the project gate with `npm run check`.
- Keep generated state, local ledgers, private holdouts, and credentials out of Git.

## Structure and boundaries

- `src/` contains the CLI, runner, adapters, ledger, and policy code; `test/` uses Node's built-in test runner.
- `integrations/` contains agent adapters and native plugins. A plugin's available tools are not the same thing as an `evofence run --adapter ...` adapter.
- Keep plugin inspection read-only unless a separately documented, explicit command delegates to the EvoFence CLI.
- Preserve contract, evidence, budget, and isolation gates. Do not claim worktree isolation is an OS sandbox.

## Current status and next step

The package is a prerelease research MVP. Check `CHANGELOG.md`, the active pull requests, and their CI before describing current release status. Do not create a release tag or publish to npm without explicit user authorization.
