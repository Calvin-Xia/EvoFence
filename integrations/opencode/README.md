# EvoFence plugin for OpenCode

This project-level plugin adds two read-only tools: `evofence_verify_ledger` and `evofence_recent_runs`. It calls only `evofence ledger verify` and `evofence ledger recent 10`; the latter returns curated summaries and omits prompts, commands, source, and evaluator output.

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
