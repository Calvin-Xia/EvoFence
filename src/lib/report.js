import { loadContract } from './contract.js';

const MICROS_PER_USD = 1_000_000;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function latestObservedByRun(events, eventType, extract) {
  const latest = new Map();
  for (const event of events) {
    if (event.event_type !== eventType) continue;
    const value = extract(event.payload ?? {});
    if (value !== null) latest.set(event.run_id ?? '', value);
  }
  return latest;
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

function buildObjective(contract, generations) {
  if (!generations.length) return null;
  const scores = generations.map((generation) => generation.objective_score).filter((score) => score !== null);
  const direction = contract?.objective?.direction === 'minimize' ? 'minimize' : contract?.objective?.direction === 'maximize' ? 'maximize' : null;
  const firstScore = scores.length ? scores[0] : null;
  const bestScore = scores.length
    ? (direction === 'minimize' ? Math.min(...scores) : Math.max(...scores))
    : null;
  const delta = firstScore === null || bestScore === null
    ? null
    : direction === 'minimize' ? firstScore - bestScore : bestScore - firstScore;
  return {
    metric: typeof contract?.objective?.name === 'string' ? contract.objective.name : null,
    direction,
    first_score: firstScore,
    best_score: bestScore,
    delta,
  };
}

export async function buildEvolutionReport({ root, ledger }) {
  const events = ledger.events();
  const generations = buildGenerations(events, ledger.generations());
  const integrity = ledger.verify();

  let contract = null;
  try {
    contract = await loadContract(root);
  } catch {
    contract = null;
  }

  const tokenTotals = latestObservedByRun(events, 'budget.tokens.observed', (payload) => (
    Number.isSafeInteger(payload.observed_total) && payload.observed_total >= 0 ? payload.observed_total : null
  ));
  const usdTotals = latestObservedByRun(events, 'budget.usd.observed', (payload) => {
    if (Number.isSafeInteger(payload.observed_total_usd_micros) && payload.observed_total_usd_micros >= 0) return payload.observed_total_usd_micros;
    if (finiteNumber(payload.observed_total_usd) !== null && payload.observed_total_usd >= 0) return Math.round(payload.observed_total_usd * MICROS_PER_USD);
    return null;
  });

  const runs = summarizeRuns(events);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_count: runs.length,
    generation_count: generations.length,
    runs,
    generations,
    objective: buildObjective(contract, generations),
    budgets: {
      tokens_total: tokenTotals.size ? [...tokenTotals.values()].reduce((total, value) => total + value, 0) : null,
      usd_total: usdTotals.size ? [...usdTotals.values()].reduce((total, value) => total + value, 0) / MICROS_PER_USD : null,
    },
    integrity: { valid: integrity.valid === true },
  };
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(value) : 'n/a';
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return value > 0 ? `+${value}` : String(value);
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
    '',
    '## Generations',
    '',
    '| generation | sha | score | improvement |',
    '| --- | --- | --- | --- |',
  ];
  for (const generation of report.generations ?? []) {
    lines.push(`| ${generation.generation_id} | ${generation.sha ?? 'n/a'} | ${formatNumber(generation.objective_score)} | ${formatDelta(generation.improvement)} |`);
  }
  lines.push('', '## Runs', '', '| run | adapter | status | iterations | accepted | rejected |', '| --- | --- | --- | --- | --- | --- |');
  for (const run of report.runs ?? []) {
    lines.push(`| ${run.run_id} | ${run.adapter} | ${run.status} | ${run.iterations} | ${run.accepted_candidates} | ${run.rejected_candidates} |`);
  }
  return `${lines.join('\n')}\n`;
}
