import { spawnSync } from 'node:child_process';
import { tool } from '@opencode-ai/plugin';

function readLedger(action, directory) {
  const args = action === 'recent' ? ['ledger', 'recent', '10'] : ['ledger', 'verify'];
  const isWindows = process.platform === 'win32';
  const result = spawnSync(isWindows ? 'evofence.cmd' : 'evofence', args, {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
    ...(isWindows ? { shell: true } : {}),
  });

  if (result.error?.code === 'ENOENT') return { error: 'EvoFence CLI was not found in PATH. Install EvoFence in the OpenCode environment.' };
  if (result.error) return { error: 'EvoFence could not read the ledger within the time limit.' };
  if (result.status !== 0) return { error: 'EvoFence could not read the ledger. Check that this repository is initialized and the ledger is readable.' };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: 'EvoFence returned an invalid ledger response.' };
  }
}

function runDoctor(directory) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(isWindows ? 'evofence.cmd' : 'evofence', ['doctor', '--adapter', 'opencode', '--json'], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
    ...(isWindows ? { shell: true } : {}),
  });

  if (result.error?.code === 'ENOENT') return { error: 'EvoFence CLI was not found in PATH. Install EvoFence in the OpenCode environment.' };
  if (result.error) return { error: 'EvoFence doctor could not complete within the time limit.' };
  if (result.status !== 0) return { error: 'EvoFence doctor refused this host. Inspect the CLI result before starting an evolution run.' };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: 'EvoFence doctor returned an invalid preflight response.' };
  }
}

export const EvoFencePlugin = async () => ({
  tool: {
    evofence_doctor: tool({
      description: 'Run the read-only `evofence doctor` preflight for the OpenCode adapter before an evolution run.',
      args: {},
      async execute(_args, context) {
        return JSON.stringify(runDoctor(context.directory));
      },
    }),
    evofence_verify_ledger: tool({
      description: 'Verify the EvoFence audit ledger hash chain in the current repository. Read-only.',
      args: {},
      async execute(_args, context) {
        return JSON.stringify(readLedger('verify', context.directory));
      },
    }),
    evofence_recent_runs: tool({
      description: 'Read up to ten sanitized EvoFence run summaries. Does not expose prompts, commands, source, or evaluator output.',
      args: {},
      async execute(_args, context) {
        return JSON.stringify(readLedger('recent', context.directory));
      },
    }),
  },
});
