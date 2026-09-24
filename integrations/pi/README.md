# EvoFence extension for Pi

This Pi extension registers two read-only tools: `evofence_verify_ledger` and `evofence_recent_runs`. It uses the Pi extension API and calls only the EvoFence ledger read commands.

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
