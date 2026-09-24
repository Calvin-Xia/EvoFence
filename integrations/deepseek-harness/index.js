import { defineTool } from '@deepseek-ai/dsh-tools';
import { Ledger, ledgerPath } from 'evofence';

export const name = 'evofence-cordis-tools';
export const inject = ['tools'];

function withLedger(read) {
  let ledger;
  try {
    ledger = new Ledger(ledgerPath(process.cwd()), { readOnly: true });
  } catch (error) {
    if (error.code === 'SQLITE_CANTOPEN' || error.code === 'ENOENT') {
      return JSON.stringify({ error: 'No EvoFence ledger was found. Start DeepSeek Harness from an initialized EvoFence repository.' });
    }
    throw error;
  }

  try {
    return JSON.stringify(read(ledger));
  } finally {
    ledger.close();
  }
}

function registerReadTool(ctx, { name, description, read }) {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return withLedger(read);
    },
  }));
}

export function apply(ctx) {
  registerReadTool(ctx, {
    name: 'evofence_verify_ledger',
    description: 'Verify the EvoFence append-only audit ledger hash chain in the current repository. Returns integrity metadata only.',
    read: (ledger) => ledger.verify(),
  });

  registerReadTool(ctx, {
    name: 'evofence_recent_runs',
    description: 'Read up to ten recent EvoFence run summaries from the current repository. Returns adapter, status, iteration counts, and duration; omits prompts, commands, source text, and evaluation output.',
    read: (ledger) => {
      const integrity = ledger.verify();
      return { integrity, runs: integrity.valid ? ledger.recentRuns(10) : [] };
    },
  });
}
