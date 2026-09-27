/**
 * `report.generations` plus the table-vs-chain consistency check.
 *
 * DOMAIN: report views (L2 node `l2_report`). Ported 1:1 from `src/lib/report.js`'s
 * `buildGenerations` / `generationEventRecords` / `generationsTableConsistent`.
 */
import type { GenerationRecord, JsonValue, LedgerEvent, ReportGenerationSummary } from '../../types/index.js';
import { finiteNumber, payloadObject } from './ledger-view.js';

interface GenerationEventRecord {
  run_id: string | null;
  sha: string | null;
  parent_sha: string | null;
  created_at: string | null;
}

export function buildGenerations(events: LedgerEvent[], generations: GenerationRecord[]): ReportGenerationSummary[] {
  const acceptedByGeneration = new Map<string, { payload: Record<string, JsonValue>; event: LedgerEvent }>();
  for (const event of events) {
    if (event.event_type !== 'candidate.accepted') continue;
    const payload = payloadObject(event.payload) ?? {};
    if (typeof payload.generation_id === 'string') acceptedByGeneration.set(payload.generation_id, { payload, event });
  }

  const records = new Map<string, ReportGenerationSummary>();
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

/** The `generation.accepted` events, keyed by generation id, for cross-checking the table. */
export function generationEventRecords(events: LedgerEvent[]): Map<string, GenerationEventRecord> {
  const records = new Map<string, GenerationEventRecord>();
  for (const event of events) {
    if (event.event_type !== 'generation.accepted') continue;
    const payload = payloadObject(event.payload) ?? {};
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

/**
 * The `generations` table is not covered by `Ledger.verify()`; its rows must match the
 * hash-chained `generation.accepted` events before anything derived from them is reported.
 */
export function generationsTableConsistent(tableRows: GenerationRecord[], eventRecords: Map<string, GenerationEventRecord>): boolean {
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
