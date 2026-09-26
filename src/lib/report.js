const MICROS_PER_USD = 1_000_000;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Per-run totals combine two sources: cumulative observations (which include every
// preceding invocation, complete or not) and complete per-invocation telemetry. The
// reported value is the best lower bound — the maximum of the complete-invocation sum
// and, over every cumulative anchor, of (anchor total + complete invocations recorded
// after that anchor). The invocation sum floors stale terminal anchors that undercount
// earlier invocations; anchored estimates recover usage from incomplete invocations;
// trailing invocation sums recover telemetry that never reached an anchor. Nothing is
// ever double counted because each candidate estimate counts every invocation at most
// once.
function runTotals(events, eventTypes, cumulative, invocation) {
  const anchorsByRun = new Map();
  const invocationsByRun = new Map();
  for (const event of events) {
    const runId = event.run_id ?? '';
    const payload = event.payload ?? {};
    if (eventTypes.includes(event.event_type)) {
      const value = cumulative(payload);
      if (value !== null) {
        const anchors = anchorsByRun.get(runId) ?? [];
        anchors.push({ seq: event.seq, value });
        anchorsByRun.set(runId, anchors);
      }
      continue;
    }
    if (event.event_type === 'adapter.finished') {
      const value = invocation(payload.reported_usage ?? {});
      if (value === null) continue;
      const invocations = invocationsByRun.get(runId) ?? [];
      invocations.push({ seq: event.seq, value });
      invocationsByRun.set(runId, invocations);
    }
  }

  const totals = new Map();
  for (const runId of new Set([...anchorsByRun.keys(), ...invocationsByRun.keys()])) {
    const anchors = anchorsByRun.get(runId) ?? [];
    const invocations = invocationsByRun.get(runId) ?? [];
    let total = invocations.length ? invocations.reduce((sum, item) => sum + item.value, 0) : null;
    for (const anchor of anchors) {
      const estimate = anchor.value + invocations
        .filter((item) => item.seq > anchor.seq)
        .reduce((sum, item) => sum + item.value, 0);
      if (total === null || estimate > total) total = estimate;
    }
    if (total !== null) totals.set(runId, total);
  }
  return totals;
}

const TOKEN_TOTAL_EVENTS = ['budget.tokens.observed', 'budget.exhausted', 'budget.termination_failed', 'run.failed', 'run.finished'];
const USD_TOTAL_EVENTS = ['budget.usd.observed', 'budget.exhausted', 'budget.termination_failed', 'run.failed', 'run.finished'];

function tokenTotal(payload) {
  for (const value of [payload.observed_total, payload.token_usage_total]) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

function usdTotalMicros(payload) {
  if (Number.isSafeInteger(payload.observed_total_usd_micros) && payload.observed_total_usd_micros >= 0) return payload.observed_total_usd_micros;
  for (const value of [payload.observed_total_usd, payload.cost_estimate_total_usd]) {
    if (finiteNumber(value) !== null && value >= 0) return Math.round(value * MICROS_PER_USD);
  }
  return null;
}

function invocationTokenTotal(usage) {
  return usage.tokens_complete === true && Number.isSafeInteger(usage.tokens_total) && usage.tokens_total >= 0
    ? usage.tokens_total
    : null;
}

function invocationUsdTotalMicros(usage) {
  return usage.cost_complete === true && usage.cost_currency === 'USD' && Number.isFinite(usage.reported_cost) && usage.reported_cost >= 0
    ? Math.round(usage.reported_cost * MICROS_PER_USD)
    : null;
}

function summarizeRuns(events) {
  const eventsByRun = new Map();
  for (const event of events) {
    if (event.run_id === null || event.run_id === undefined) continue;
    if (!eventsByRun.has(event.run_id)) eventsByRun.set(event.run_id, []);
    eventsByRun.get(event.run_id).push(event);
  }

  const started = events.filter((event) => event.event_type === 'run.started' && event.run_id);
  return started.reverse().map((startedEvent) => {
    const startedPayload = startedEvent.payload ?? {};
    const summary = {
      run_id: startedEvent.run_id,
      started_at: startedEvent.created_at,
      adapter: typeof startedPayload.adapter === 'string' ? startedPayload.adapter : 'unknown',
      status: 'INCOMPLETE',
      iterations: 0,
      accepted_candidates: 0,
      rejected_candidates: 0,
    };
    const observedIterations = new Set();
    const rejectedIterations = new Set();
    let hasAuthoritativeIterations = false;

    for (const event of eventsByRun.get(startedEvent.run_id) ?? []) {
      const payload = event.payload ?? {};
      if (Number.isInteger(payload.iteration) && payload.iteration > 0) observedIterations.add(payload.iteration);

      if (
        event.event_type === 'candidate.rejected'
        || (event.event_type === 'gate.decision' && payload.decision === 'REJECT')
      ) {
        rejectedIterations.add(Number.isInteger(payload.iteration) && payload.iteration > 0
          ? `iteration:${payload.iteration}`
          : `event:${event.seq}`);
      }

      if (event.event_type === 'candidate.accepted') summary.accepted_candidates += 1;
      else if (event.event_type === 'run.finished') {
        summary.status = typeof payload.status === 'string' ? payload.status : 'FINISHED';
        if (Number.isInteger(payload.iterations) && payload.iterations >= 0) {
          summary.iterations = payload.iterations;
          hasAuthoritativeIterations = true;
        }
      } else if (event.event_type === 'run.failed') {
        // Failed and resource-exhausted runs must not read as interrupted runs
        // (status stays INCOMPLETE only when no terminal run event exists).
        summary.status = 'FAILED';
        if (typeof payload.code === 'string') summary.failure_code = payload.code;
      }
    }

    summary.rejected_candidates = rejectedIterations.size;
    if (!hasAuthoritativeIterations) summary.iterations = observedIterations.size ? Math.max(...observedIterations) : 0;
    return summary;
  });
}

function buildGenerations(events, generations) {
  const acceptedByGeneration = new Map();
  for (const event of events) {
    if (event.event_type !== 'candidate.accepted') continue;
    const payload = event.payload ?? {};
    if (typeof payload.generation_id === 'string') acceptedByGeneration.set(payload.generation_id, { payload, event });
  }

  const records = new Map();
  for (const generation of generations) {
    const accepted = acceptedByGeneration.get(generation.generation_id);
    records.set(generation.generation_id, {
      generation_id: generation.generation_id,
      sha: generation.sha,
      parent_sha: generation.parent_sha,
      objective_score: finiteNumber(accepted?.payload.objective_score),
      improvement: finiteNumber(accepted?.payload.improvement),
      run_id: typeof generation.run_id === 'string' ? generation.run_id : accepted?.event.run_id ?? null,
    });
  }

  for (const [generationId, { payload, event }] of acceptedByGeneration) {
    if (records.has(generationId)) continue;
    records.set(generationId, {
      generation_id: generationId,
      sha: typeof payload.sha === 'string' ? payload.sha : null,
      parent_sha: typeof payload.parent_sha === 'string' ? payload.parent_sha : null,
      objective_score: finiteNumber(payload.objective_score),
      improvement: finiteNumber(payload.improvement),
      run_id: typeof event.run_id === 'string' ? event.run_id : null,
    });
  }

  return [...records.values()];
}

// The `generations` table is not covered by Ledger.verify(); its rows must match the
// hash-chained `generation.accepted` events before anything derived from them is reported.
function generationEventRecords(events) {
  const records = new Map();
  for (const event of events) {
    if (event.event_type !== 'generation.accepted') continue;
    const payload = event.payload ?? {};
    if (typeof payload.generation_id !== 'string') continue;
    records.set(payload.generation_id, {
      run_id: typeof payload.run_id === 'string' ? payload.run_id : null,
      sha: typeof payload.sha === 'string' ? payload.sha : null,
      parent_sha: typeof payload.parent_sha === 'string' ? payload.parent_sha : null,
      created_at: typeof payload.created_at === 'string' ? payload.created_at : null,
    });
  }
  return records;
}

function generationsTableConsistent(tableRows, eventRecords) {
  if (tableRows.length !== eventRecords.size) return false;
  for (const row of tableRows) {
    const record = eventRecords.get(row.generation_id);
    if (!record
      || record.run_id !== row.run_id
      || record.sha !== row.sha
      || record.parent_sha !== row.parent_sha
      || record.created_at !== row.created_at) return false;
  }
  return true;
}

function objectiveSnapshot(event) {
  const objective = event.payload?.contract_snapshot?.objective;
  return {
    metric: typeof objective?.name === 'string' && objective.name.trim() ? objective.name : null,
    direction: objective?.direction === 'minimize' || objective?.direction === 'maximize' ? objective.direction : null,
  };
}

function summarizeObjectiveGroup(group) {
  const firstScore = group.scores[0];
  const bestScore = group.direction === null ? null
    : group.direction === 'minimize' ? Math.min(...group.scores) : Math.max(...group.scores);
  return {
    metric: group.metric,
    direction: group.direction,
    first_score: firstScore,
    best_score: bestScore,
    delta: bestScore === null ? null
      : group.direction === 'minimize' ? firstScore - bestScore : bestScore - firstScore,
  };
}

// Objective metadata comes from each run's `contract_snapshot`, never from the contract
// currently on disk: labels and direction are historical facts of the run that produced
// the score. Unknown direction stays null (best_score/delta stay null) — it is never
// assumed to be maximize.
function buildObjective(events, generations) {
  const snapshotByRun = new Map();
  for (const event of events) {
    if (event.event_type === 'run.started' && event.run_id) snapshotByRun.set(event.run_id, objectiveSnapshot(event));
  }

  const groups = new Map();
  for (const generation of generations) {
    if (generation.objective_score === null) continue;
    const snapshot = (generation.run_id && snapshotByRun.get(generation.run_id)) || { metric: null, direction: null };
    const key = `${snapshot.metric ?? ''}::${snapshot.direction ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...snapshot, scores: [] });
    groups.get(key).scores.push(generation.objective_score);
  }

  const summaries = [...groups.values()].map(summarizeObjectiveGroup);
  if (!summaries.length) return null;
  if (summaries.length === 1) return summaries[0];
  // Incompatible objectives (different metrics/directions, or missing snapshots): refuse
  // to combine them into one best_score/delta and report per-group aggregates only.
  return {
    metric: null,
    direction: null,
    first_score: null,
    best_score: null,
    delta: null,
    groups: summaries,
  };
}

function emptyReport(generated_at, integrity) {
  return {
    schema_version: 1,
    generated_at,
    run_count: 0,
    generation_count: 0,
    runs: [],
    generations: [],
    objective: null,
    budgets: { tokens_total: null, usd_total: null },
    integrity,
  };
}

export async function buildEvolutionReport({ root, ledger }) {
  const generated_at = new Date().toISOString();
  let snapshot;
  try {
    // One transaction: verification and both reads see the same ledger state.
    snapshot = ledger.readSnapshot();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // The hash chain matched but at least one payload is not valid JSON (for example a
    // tampered ledger whose chain was recomputed). Refuse to summarize unreadable payloads.
    return emptyReport(generated_at, {
      valid: false,
      failed_at_seq: null,
      expected_previous_hash: null,
      observed_hash: null,
      parse_failed: true,
    });
  }

  const integrity = snapshot.integrity;
  if (!integrity.valid) {
    return emptyReport(generated_at, {
      valid: false,
      failed_at_seq: integrity.sequence ?? null,
      expected_previous_hash: integrity.expected_previous_hash ?? null,
      observed_hash: integrity.observed_hash ?? null,
    });
  }

  const events = snapshot.events;
  const tableGenerations = snapshot.generations;
  if (!generationsTableConsistent(tableGenerations, generationEventRecords(events))) {
    return emptyReport(generated_at, {
      valid: false,
      failed_at_seq: null,
      expected_previous_hash: null,
      observed_hash: null,
      generations_mismatch: true,
    });
  }
  const generations = buildGenerations(events, tableGenerations);

  const tokenTotals = runTotals(events, TOKEN_TOTAL_EVENTS, tokenTotal, invocationTokenTotal);
  const usdTotals = runTotals(events, USD_TOTAL_EVENTS, usdTotalMicros, invocationUsdTotalMicros);

  const runs = summarizeRuns(events);
  return {
    schema_version: 1,
    generated_at,
    run_count: runs.length,
    generation_count: generations.length,
    runs,
    generations,
    objective: buildObjective(events, generations),
    budgets: {
      tokens_total: tokenTotals.size ? [...tokenTotals.values()].reduce((total, value) => total + value, 0) : null,
      usd_total: usdTotals.size ? [...usdTotals.values()].reduce((total, value) => total + value, 0) / MICROS_PER_USD : null,
    },
    integrity: { valid: true },
  };
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(value) : 'n/a';
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return value > 0 ? `+${value}` : String(value);
}

function formatIntegrity(integrity) {
  if (integrity?.valid) return 'valid';
  if (integrity?.parse_failed) return 'INVALID (unparseable event payload)';
  if (integrity?.generations_mismatch) return 'INVALID (generations table disagrees with the event chain)';
  return `INVALID${Number.isInteger(integrity?.failed_at_seq) ? ` (failed at seq ${integrity.failed_at_seq})` : ''}`;
}

export function formatEvolutionReport(report) {
  const lines = [
    '# EvoFence Evolution Report',
    '',
    `- Runs: ${report.run_count}`,
    `- Generations: ${report.generation_count}`,
    `- Objective delta: ${formatDelta(report.objective?.delta)}`,
    `- Tokens total: ${formatNumber(report.budgets?.tokens_total)}`,
    `- USD total: ${formatNumber(report.budgets?.usd_total)}`,
    `- Ledger integrity: ${formatIntegrity(report.integrity)}`,
  ];
  for (const group of report.objective?.groups ?? []) {
    lines.push(`- Objective ${group.metric ?? 'unknown'} (${group.direction ?? 'unknown direction'}): delta ${formatDelta(group.delta)}`);
  }
  lines.push(
    '',
    '## Generations',
    '',
    '| generation | sha | score | improvement |',
    '| --- | --- | --- | --- |',
  );
  for (const generation of report.generations ?? []) {
    lines.push(`| ${generation.generation_id} | ${generation.sha ?? 'n/a'} | ${formatNumber(generation.objective_score)} | ${formatDelta(generation.improvement)} |`);
  }
  lines.push('', '## Runs', '', '| run | adapter | status | failure_code | iterations | accepted | rejected |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const run of report.runs ?? []) {
    lines.push(`| ${run.run_id} | ${run.adapter} | ${run.status} | ${run.failure_code ?? ''} | ${run.iterations} | ${run.accepted_candidates} | ${run.rejected_candidates} |`);
  }
  return `${lines.join('\n')}\n`;
}
