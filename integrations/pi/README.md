# EvoFence extension for Pi

This Pi extension registers two read-only tools: `evofence_verify_ledger` and `evofence_recent_runs`. It uses the Pi extension API and calls only the EvoFence ledger read commands.

## Install from a checkout

Install the extension's schema dependency, then load it explicitly:

```sh
npm ci --prefix integrations/pi
pi --extension ./integrations/pi/evofence.js
```

Install EvoFence CLI in the same environment. Start Pi from the initialized EvoFence repository (or the project whose ledger you want to inspect). The tools never initialize a repository or modify Git state.
