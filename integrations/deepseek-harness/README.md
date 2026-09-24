# EvoFence tools for DeepSeek Harness

This local Cordis bundle adds two read-only tools to DeepSeek Harness:

- `evofence_verify_ledger` checks the SQLite ledger hash chain.
- `evofence_recent_runs` returns up to ten summaries with adapter, status, iteration counts, and duration. It does not return prompts, configured commands, source text, or evaluator output.

The plugin opens the ledger in SQLite read-only mode. It does not start an evolution run, execute contract checks, accept candidates, or change Git state. The current working directory must be an initialized EvoFence repository.

## Install from this checkout

Requires a compatible DeepSeek Harness installation and Node.js 22.13 or newer. From the EvoFence repository root, add the local bundle to a Harness profile:

```sh
dsh plugin --profile web add ./integrations/deepseek-harness
dsh --profile web --dump-config
dsh --profile web
```

The first command installs the bundle and its local `evofence` dependency into the selected profile. The config dump should show the `@local/evofence-deepseek-harness` layer. Launch Harness from the EvoFence repository root so the tools open the intended ledger.

To remove it:

```sh
dsh plugin --profile web remove @local/evofence-deepseek-harness
```

DeepSeek Harness documents Cordis plugins as `apply(ctx)` modules that inject the `tools` service and register tools with `defineTool`. Its public APIs are still pre-stable, so this bundle may need updates as Harness changes.
