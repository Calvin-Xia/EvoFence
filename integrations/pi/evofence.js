import { spawnSync } from 'node:child_process';
import { Type } from 'typebox';

function readLedger(action, cwd, bundle) {
  const args = action === 'recent'
    ? ['ledger', 'recent', '10']
    : bundle === undefined ? ['ledger', 'verify'] : ['ledger', 'verify', '--bundle', bundle];
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

function runDoctor(cwd) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(isWindows ? 'evofence.cmd' : 'evofence', ['doctor', '--adapter', 'pi', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
    timeout: 15_000,
    windowsHide: true,
    ...(isWindows ? { shell: true } : {}),
  });

  if (result.error?.code === 'ENOENT') return { error: 'EvoFence CLI was not found in PATH. Install EvoFence in the Pi environment.' };
  if (result.error) return { error: 'EvoFence doctor could not complete within the time limit.' };
  if (result.status !== 0) return { error: 'EvoFence doctor refused this host. Inspect the CLI result before starting an evolution run.' };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: 'EvoFence doctor returned an invalid preflight response.' };
  }
}

function doctorToolResult(cwd) {
  return JSON.stringify(runDoctor(cwd));
}

export default function evofenceExtension(pi) {
  const registerDoctor = () => {
    const handler = async (_args, context) => {
      context?.ui?.notify?.(doctorToolResult(context.cwd ?? process.cwd()), 'info');
    };
    if (typeof pi.registerCommand === 'function') {
      pi.registerCommand('evofence-doctor', {
        description: 'Run the read-only `evofence doctor` preflight for the Pi adapter.',
        handler,
      });
      return;
    }
    pi.registerTool({
      name: 'evofence_doctor',
      label: 'Run EvoFence doctor',
      description: 'Run the read-only `evofence doctor` preflight for the Pi adapter.',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, context) {
        return { content: [{ type: 'text', text: doctorToolResult(context.cwd ?? process.cwd()) }], details: {} };
      },
    });
  };

  registerDoctor();

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

  pi.registerTool({
    name: 'evofence_verify_bundle',
    label: 'Verify EvoFence ledger bundle',
    description: 'Verify an exported EvoFence ledger bundle without opening the local SQLite ledger. Read-only.',
    parameters: Type.Object({
      bundle: Type.String({ description: 'Path to the exported ledger bundle JSON file.' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      return { content: [{ type: 'text', text: JSON.stringify(readLedger('verify', context.cwd ?? process.cwd(), params.bundle)) }], details: {} };
    },
  });
}
