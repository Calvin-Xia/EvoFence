import { spawnSync } from 'node:child_process';
import { Type } from 'typebox';

function readLedger(action, cwd) {
  const args = action === 'recent' ? ['ledger', 'recent', '10'] : ['ledger', 'verify'];
  const isWindows = process.platform === 'win32';
  const result = spawnSync(isWindows ? 'evofence.cmd' : 'evofence', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
    ...(isWindows ? { shell: true } : {}),
  });

  if (result.error?.code === 'ENOENT') return { error: 'EvoFence CLI was not found in PATH. Install EvoFence in the Pi environment.' };
  if (result.error) return { error: 'EvoFence could not read the ledger within the time limit.' };
  if (result.status !== 0) return { error: 'EvoFence could not read the ledger. Check that this repository is initialized and the ledger is readable.' };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: 'EvoFence returned an invalid ledger response.' };
  }
}

export default function evofenceExtension(pi) {
  pi.registerTool({
    name: 'evofence_verify_ledger',
    label: 'Verify EvoFence ledger',
    description: 'Verify the EvoFence audit ledger hash chain in the current repository. Read-only.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, context) {
      return { content: [{ type: 'text', text: JSON.stringify(readLedger('verify', context.cwd ?? process.cwd())) }], details: {} };
    },
  });

  pi.registerTool({
    name: 'evofence_recent_runs',
    label: 'Recent EvoFence runs',
    description: 'Read up to ten sanitized EvoFence run summaries. Omits prompts, commands, source, and evaluator output.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, context) {
      return { content: [{ type: 'text', text: JSON.stringify(readLedger('recent', context.cwd ?? process.cwd())) }], details: {} };
    },
  });
}
