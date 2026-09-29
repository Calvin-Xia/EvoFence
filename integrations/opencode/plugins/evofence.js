import { tool } from '@opencode-ai/plugin';
import { runEvoFence } from './cli.js';

const LEDGER_MESSAGES = {
  missingMessage: 'EvoFence CLI was not found in PATH. Install EvoFence in the OpenCode environment.',
  processErrorMessage: 'EvoFence could not read the ledger within the time limit.',
  failureMessage: 'EvoFence could not read the ledger. Check that this repository is initialized and the ledger is readable.',
  invalidMessage: 'EvoFence returned an invalid ledger response.',
};

const DOCTOR_MESSAGES = {
  missingMessage: LEDGER_MESSAGES.missingMessage,
  processErrorMessage: 'EvoFence doctor could not complete within the time limit.',
  failureMessage: 'EvoFence doctor refused this host. Inspect the CLI result before starting an evolution run.',
  invalidMessage: 'EvoFence doctor returned an invalid preflight response.',
};

function readLedger(action, directory, bundle) {
  const args = action === 'recent'
    ? ['ledger', 'recent', '10']
    : bundle === undefined ? ['ledger', 'verify'] : ['ledger', 'verify', '--bundle', bundle];
  return runEvoFence(args, directory, LEDGER_MESSAGES);
}

function runDoctor(directory) {
  return runEvoFence(['doctor', '--adapter', 'opencode', '--json'], directory, DOCTOR_MESSAGES);
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
    evofence_verify_bundle: tool({
      description: 'Verify an exported EvoFence ledger bundle without opening the local SQLite ledger. Read-only.',
      args: {
        bundle: tool.schema.string(),
      },
      async execute(args, context) {
        return JSON.stringify(readLedger('verify', context.directory, args.bundle));
      },
    }),
  },
});
