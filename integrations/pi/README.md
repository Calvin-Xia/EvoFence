# EvoFence extension for Pi

This Pi extension registers read-only ledger tools: `evofence_verify_ledger`, `evofence_recent_runs`, and `evofence_verify_bundle`. It also registers the host-native `evofence-doctor` command when Pi exposes `registerCommand`, with a read-only tool fallback otherwise. It uses the Pi extension API and calls only EvoFence read commands.

## USD budgets

The Pi adapter supports `budgets.max_usd`, subject to a host that can terminate the agent process tree. Its USD value is an after-the-fact cumulative estimate, not a hard request-before-send limit; the response that crosses the threshold has already completed; and the estimate is not the service provider's final bill. If process control is unavailable, preflight refuses with `UNSUPPORTED_COST_BUDGET_PROCESS_CONTROL` and the message `This host cannot terminate the pi process tree. EvoFence refused to start a USD-budgeted run.` The alternative is to use a host that can terminate the process tree or remove the live USD budget by setting `budgets.max_usd` to `null`.

## Auto-load from this checkout

Pi automatically discovers the project-local `.pi/extensions/evofence.js` entry when started from this repository. Install the extension's schema dependency first:

```sh
npm ci --prefix integrations/pi
pi
```

Install EvoFence CLI in the same environment. The project-local entry delegates to the integration implementation in `integrations/pi/evofence.js`; the tools never initialize a repository or modify Git state.

## Load from another project

When using a checkout to inspect a different repository, start Pi in the target repository and load the extension explicitly:

```sh
pi --extension /path/to/EvoFence/integrations/pi/evofence.js
```
