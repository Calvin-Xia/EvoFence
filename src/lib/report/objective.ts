/**
 * `report.objective`: per-metric/direction aggregates over the accepted generations.
 *
 * DOMAIN: report views (L2 node `l2_report`). Ported 1:1 from `src/lib/report.js`'s
 * `objectiveSnapshot` / `summarizeObjectiveGroup` / `buildObjective`.
 *
 * Objective metadata comes from each run's `contract_snapshot`, never from the contract currently
 * on disk: labels and direction are historical facts of the run that produced the score. An
 * unknown direction stays `null` (best_score/delta stay `null`) — it is never assumed to be
 * maximize. A single group is returned WITHOUT the `groups` key (spec-f2 deep-equals it).
 */
import type { LedgerEvent, ReportGenerationSummary, ReportObjective, ReportObjectiveGroup } from '../../types/index.js';
import { payloadObject } from './ledger-view.js';

type Direction = 'maximize' | 'minimize';

interface ObjectiveSnapshot {
  metric: string | null;
  direction: Direction | null;
}

function objectiveSnapshot(event: LedgerEvent): ObjectiveSnapshot {
  const snapshot = payloadObject(payloadObject(event.payload)?.contract_snapshot);
  const objective = payloadObject(snapshot?.objective);
  return {
    metric: typeof objective?.name === 'string' && objective.name.trim() ? objective.name : null,
    direction: objective?.direction === 'minimize' || objective?.direction === 'maximize' ? objective.direction : null,
  };
}

function summarizeObjectiveGroup(group: ObjectiveSnapshot & { scores: number[] }): ReportObjectiveGroup {
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

export function buildObjective(events: LedgerEvent[], generations: ReportGenerationSummary[]): ReportObjective | null {
  const snapshotByRun = new Map<string, ObjectiveSnapshot>();
  for (const event of events) {
    if (event.event_type === 'run.started' && event.run_id) snapshotByRun.set(event.run_id, objectiveSnapshot(event));
  }

  const groups = new Map<string, ObjectiveSnapshot & { scores: number[] }>();
  for (const generation of generations) {
    if (generation.objective_score === null) continue;
    const snapshot = (generation.run_id && snapshotByRun.get(generation.run_id)) || { metric: null, direction: null };
    const key = `${snapshot.metric ?? ''}::${snapshot.direction ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...snapshot, scores: [] });
    groups.get(key)!.scores.push(generation.objective_score);
  }

  const summaries = [...groups.values()].map(summarizeObjectiveGroup);
  if (!summaries.length) return null;
  if (summaries.length === 1) return summaries[0];
  // Incompatible objectives (different metrics/directions, or missing snapshots): refuse to
  // combine them into one best_score/delta and report per-group aggregates only.
  return {
    metric: null,
    direction: null,
    first_score: null,
    best_score: null,
    delta: null,
    groups: summaries,
  };
}
