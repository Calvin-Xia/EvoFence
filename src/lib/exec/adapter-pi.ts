/**
 * Exec domain · Pi tool-strategy telemetry sidecar.
 *
 * Extracted verbatim from `src/lib/adapter.js`. The sidecar is fail-open telemetry: no gate
 * reads it, and every error path degrades to `unavailablePiToolStrategy(phase)`.
 */
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { summarizePiToolStrategyTelemetry, unavailablePiToolStrategy } from '../pi-tool-strategy.js';
import type { PiToolStrategySummary } from '../../types/index.js';
import type { AdapterPhase } from '../../types/index.js';

export interface PiToolStrategyLog {
  stage: 'proposal' | 'implementation';
  logPath: string | null;
}

export async function createPiToolStrategyLog(cwd: string, phase: string): Promise<PiToolStrategyLog> {
  const stage: 'proposal' | 'implementation' = phase === 'proposal' ? 'proposal' : 'implementation';
  const logPath = path.join(cwd, '.evofence-out', 'pi-tool-strategy-' + stage + '-' + randomUUID() + '.ndjson');
  try {
    await writeFile(logPath, '', { flag: 'wx', mode: 0o600 });
    return { stage, logPath };
  } catch {
    return { stage, logPath: null };
  }
}

export async function readPiToolStrategySummary(logPath: string | null, phase: AdapterPhase): Promise<PiToolStrategySummary> {
  if (!logPath) return unavailablePiToolStrategy(phase) as unknown as PiToolStrategySummary;
  try {
    const info = await lstat(logPath);
    if (!info.isFile() || info.isSymbolicLink()) return unavailablePiToolStrategy(phase) as unknown as PiToolStrategySummary;
    if (info.size > 256 * 1024) {
      return { ...unavailablePiToolStrategy(phase), telemetry_truncated: true } as unknown as PiToolStrategySummary;
    }
    const content = await readFile(logPath, 'utf8');
    return summarizePiToolStrategyTelemetry(content, { phase } as unknown as { maxBytes?: number }) as unknown as PiToolStrategySummary;
  } catch {
    return unavailablePiToolStrategy(phase) as unknown as PiToolStrategySummary;
  }
}
