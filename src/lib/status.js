function rejectionKey(event) {
  const iteration = event.payload?.iteration;
  return Number.isInteger(iteration) && iteration > 0 ? `iteration:${iteration}` : `event:${event.seq}`;
}

function zeroTotals() {
  return { runs: 0, generations: 0, accepted_candidates: 0, rejected_candidates: 0 };
}

function aggregateRuns(ledger) {
  const totals = zeroTotals();
  const rejectedByRun = new Map();

  for (const event of ledger.events()) {
    const payload = event.payload ?? {};
    if (event.event_type === 'run.started' && event.run_id) totals.runs += 1;
    else if (event.event_type === 'generation.accepted') totals.generations += 1;
    else if (event.event_type === 'candidate.accepted') totals.accepted_candidates += 1;

    if (
      event.event_type === 'candidate.rejected'
      || (event.event_type === 'gate.decision' && payload.decision === 'REJECT')
    ) {
      const scope = event.run_id ?? '(no run)';
      let keys = rejectedByRun.get(scope);
      if (!keys) {
        keys = new Set();
        rejectedByRun.set(scope, keys);
      }
      keys.add(rejectionKey(event));
    }
  }

  for (const keys of rejectedByRun.values()) totals.rejected_candidates += keys.size;

  return { totals, recent_runs: ledger.recentRuns(5) };
}

export function emptyStatus(root) {
  return {
    root: String(root).replaceAll('\\', '/'),
    active_generation: null,
    integrity: { valid: true },
    recent_runs: [],
    totals: zeroTotals(),
  };
}

export async function buildStatus({ root, ledger }) {
  const verification = ledger.verify();
  const status = {
    root: String(root).replaceAll('\\', '/'),
    active_generation: ledger.activeGeneration() ?? null,
    integrity: { valid: verification.valid },
    recent_runs: [],
    totals: zeroTotals(),
  };
  try {
    Object.assign(status, aggregateRuns(ledger));
  } catch (error) {
    // verify() hashes the raw payload_json column, so malformed payload JSON is a
    // corruption symptom it detects without parsing. Keep the failed-integrity
    // presentation instead of crashing the diagnostic with a SyntaxError.
    if (verification.valid || !(error instanceof SyntaxError)) throw error;
  }
  return status;
}

export function formatStatus(status) {
  const lines = [`EvoFence status: ${status.root}`];
  lines.push(status.active_generation
    ? `Active generation: ${status.active_generation.generation_id} (${status.active_generation.sha})`
    : 'Active generation: none');
  lines.push(`Ledger integrity: ${status.integrity?.valid ? 'ok' : 'FAILED'}`);
  const totals = status.totals ?? {};
  lines.push(`Totals: runs=${totals.runs ?? 0} generations=${totals.generations ?? 0} accepted_candidates=${totals.accepted_candidates ?? 0} rejected_candidates=${totals.rejected_candidates ?? 0}`);
  lines.push('Recent runs:');
  for (const run of status.recent_runs ?? []) {
    lines.push(`  ${run.run_id}  ${run.adapter}  ${run.status}  iterations=${run.iterations}`);
  }
  return lines.join('\n');
}
