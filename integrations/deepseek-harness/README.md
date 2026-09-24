# EvoFence tools for DeepSeek Harness

This Cordis bundle adds two read-only EvoFence ledger tools to DeepSeek Harness:

- `evofence_verify_ledger` checks the SQLite ledger hash chain.
- `evofence_recent_runs` returns up to ten summaries with adapter, status, iteration counts, and duration. It does not return prompts, configured commands, source text, or evaluator output.

The Cordis ID is `evofence-tools`, the bundle package is `@local/evofence-deepseek-harness`, and the exported plugin is `evofence-cordis-tools`. These project-prefixed identifiers keep this integration distinct from other DSH plugins. Tool names use the `evofence_` prefix.

The plugin opens `.evofence/ledger.sqlite` under the current working directory in SQLite read-only mode. At runtime it reads only that ledger; it does not access the network, spawn processes, read credentials, start an evolution run, execute contract checks, accept candidates, or change Git state. The current working directory must be an initialized EvoFence repository. Missing ledgers return a clear error; ledger integrity failures are reported by the verification tool.

## Compatibility and dependencies

- Node.js: `^22.19.0 || >=24.0.0`
- DeepSeek Harness: `0.1.7-rc.1` (the exact version exercised for this bundle)
- `@deepseek-ai/dsh-tools` peer: `0.1.7-rc.1`, matching the DSH runtime compatibility contract.
- Runtime dependency: `evofence@0.2.0`, which uses `better-sqlite3` and `yaml`.

`better-sqlite3` includes a native install/build step (`prebuild-install || node-gyp rebuild`). Installing the bundle may download a prebuilt native module or compile it locally. DeepSeek Harness uses pnpm, which may block native build scripts until the user reviews and allows the exact package in that Profile. Do not enable build scripts globally or grant a broad allowlist to install this bundle.

The bundle is distributed from the `integrations/deepseek-harness` subdirectory of the canonical EvoFence GitHub repository. Its manifest points back to that repository and declares the subdirectory for monorepo discovery. The bundle is not separately published to npm.

## Install from this checkout

From the EvoFence repository root, add the local bundle to a disposable or selected Harness Profile:

```sh
export DSH_HOME=/absolute/path/to/temporary-dsh-home
dsh --profile evofence-smoke --from-default-profile web --dump-default-config
dsh plugin --profile evofence-smoke add file:./integrations/deepseek-harness
dsh --profile evofence-smoke --dump-config
dsh --profile evofence-smoke --no-open --host 127.0.0.1 --port 0
```

The composed config should include the `@local/evofence-deepseek-harness` bundle row. Its entry registers the two tools listed above. Launch Harness from the EvoFence repository root so the tools open the intended ledger. DSH Profile commands persist state under the configured DSH home; use a temporary `DSH_HOME` when collecting install or startup evidence.

To remove it:

```sh
dsh plugin --profile evofence-smoke remove @local/evofence-deepseek-harness
```

## Disposable Profile evidence

Checked on 2026-09-24 with Node.js 24.12.0, DeepSeek Harness 0.1.7-rc.1, and pnpm 10.34.5. The run used a fresh temporary `DSH_HOME`, an empty temporary workspace, loopback-only web binding, `DSH_PERMISSION_MODE=read-only`, `DSH_TELEMETRY_MODE=DISABLED`, and an environment with API-key/token/secret variables removed.

| Operation | Evidence |
| --- | --- |
| Install | `dsh plugin --profile evofence-smoke add file:./integrations/deepseek-harness` completed successfully. The composed profile showed Cordis ID `evofence-tools` and bundle `@local/evofence-deepseek-harness`. |
| Start | `dsh --profile evofence-smoke --no-open --host 127.0.0.1 --port 0` started the web app. An unauthenticated loopback request returned HTTP 401, confirming the local server and its auth fence responded. No prompt, model request, or tool call was made. |
| Uninstall | `dsh plugin --profile evofence-smoke remove @local/evofence-deepseek-harness` completed; a subsequent composed-config check no longer showed the bundle or Cordis ID. |

This verifies installation, profile startup, and removal for the exact DSH version above. It does not certify the external marketplace's separate supply-chain review or constitute an independent security audit.

DeepSeek Harness documents Cordis plugins as `apply(ctx)` modules that inject the `tools` service and register tools with `defineTool`. Its public APIs are still pre-stable, so this bundle may need updates as Harness changes. A marketplace catalog decision is separate from this runtime compatibility evidence and from the supply-chain review of the native SQLite dependency.
