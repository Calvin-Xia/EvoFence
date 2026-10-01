/** Providers measure registered, schema-pinned observations, never prose completion claims. */
import { decode } from '../../protocol/index.js';
import { canonical, storeFail, storeOk } from '../store/index.js';
import type { StoreResult } from '../store/index.js';
import type { AdmittedArtifact } from '../artifacts/index.js';
import type { Measurement, Provider, TaskContract } from './types.js';

type Options = Pick<Provider, 'id' | 'version' | 'schema' | 'producer' | 'evidenceKind' | 'privateTests'>;
function json(bytes: string): StoreResult<unknown> {
  try { return storeOk(JSON.parse(bytes)); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return storeFail('EFK_SCHEMA_INVALID', 'measurement is not JSON');
  }
}
function measurement(metric: Provider['metric'], refs: Measurement['refs'], status: Measurement['status'],
  gapReason: string | null, repair: string, passRate: number | null = null, outcomeIds: readonly string[] = []): Measurement {
  return { metric, refs, status, gapReason, repair, passRate, outcomeIds };
}
function provider(options: Options, metric: Provider['metric'],
  measure: (task: TaskContract, evidence: readonly AdmittedArtifact[]) => StoreResult<Measurement>): Provider {
  return { ...options, metric, measure(task, evidence) {
    const selected = evidence.filter(e => canonical(e.ref.schema) === canonical(options.schema)
      && canonical(e.ref.producer) === canonical(options.producer));
    if (selected.length === 0) return storeOk(measurement(metric, [], 'unknown', `${metric}-evidence-missing`,
      `Collect a fresh ${metric} observation through the registered provider.`));
    return measure(task, selected);
  } };
}

/** Strict all-tests acceptance: zero tests, skipped tests or nonzero exit cannot pass. */
export function testsProvider(options: Options): Provider {
  return provider(options, 'tests', (_task, evidence) => {
    let total = 0, passed = 0, failed = false;
    for (const item of evidence) {
      const parsed = json(item.bytes);
      if (!parsed.ok) return parsed;
      const v = parsed.value as { total?: number; passed?: number; failed?: number; skipped?: number; exitCode?: number } | null;
      if (v === null || typeof v !== 'object' || !['total', 'passed', 'failed', 'skipped', 'exitCode']
        .every(k => Number.isSafeInteger(v[k as keyof typeof v]) && v[k as keyof typeof v]! >= 0)
        || v.total! !== v.passed! + v.failed! + v.skipped!) {
        return storeFail('EFK_SCHEMA_INVALID', 'tests observation needs consistent integer counts and an exit code');
      }
      total += v.total!; passed += v.passed!;
      failed ||= v.failed! > 0 || v.skipped! > 0 || v.exitCode! !== 0;
    }
    const status = failed ? 'failed' : total === 0 ? 'unknown' : 'passed';
    return storeOk(measurement('tests', evidence.map(e => e.ref), status,
      status === 'passed' ? null : total === 0 ? 'tests-empty' : 'tests-failed',
      'Repair the observed behavior and rerun all required checks without skipping tests.', total === 0 ? null : passed / total));
  });
}

/** The outcome observation explicitly enumerates every contract outcome; aggregate true is ignored. */
export function outcomeProvider(options: Options): Provider {
  return provider(options, 'outcome', (task, evidence) => {
    const values: { outcomeId: string; met: boolean | null }[] = [];
    for (const item of evidence) {
      const parsed = json(item.bytes);
      if (!parsed.ok) return parsed;
      const v = parsed.value as { outcomes?: unknown } | null;
      if (v === null || typeof v !== 'object' || !Array.isArray(v.outcomes) || !v.outcomes.every(o =>
        o !== null && typeof o === 'object' && typeof o.outcomeId === 'string' && [true, false, null].includes(o.met))) {
        return storeFail('EFK_SCHEMA_INVALID', 'outcome observation needs explicit outcomeId/met entries');
      }
      values.push(...v.outcomes);
    }
    const required = task.requiredOutcomes.map(o => o.outcomeId);
    const failed = values.some(v => required.includes(v.outcomeId) && v.met === false);
    const complete = required.every(id => values.filter(v => v.outcomeId === id).length === 1
      && values.find(v => v.outcomeId === id)!.met === true) && values.every(v => required.includes(v.outcomeId));
    return storeOk(measurement('outcome', evidence.map(e => e.ref), failed ? 'failed' : complete ? 'passed' : 'unknown',
      failed ? 'outcomes-failed' : complete ? null : 'outcomes-incomplete',
      'Verify every declared outcome independently and attach its fresh observation.', null,
      values.filter(v => v.met === true).map(v => v.outcomeId)));
  });
}

/** A deliverable must have real nonempty bytes and an accepted schema/evidence kind. */
export function artifactProvider(options: Options): Provider {
  return provider(options, 'artifact', (task, evidence) => {
    const outcomes = task.requiredOutcomes.filter(o => canonical(o.schema) === canonical(options.schema)
      && o.evidenceKinds.includes(options.evidenceKind)).map(o => o.outcomeId);
    const complete = outcomes.length > 0 && evidence.every(e => e.bytes.trim().length > 0);
    return storeOk(measurement('artifact', evidence.map(e => e.ref), complete ? 'passed' : 'unknown',
      complete ? null : 'artifacts-incomplete', 'Produce the required deliverable with the declared schema and rerun validation.', null, outcomes));
  });
}

/** Typed host receipt is observation only; it cannot sign a task decision. */
export function hostProvider(options: Options): Provider {
  return provider(options, 'host', (_task, evidence) => {
    const statuses: Measurement['status'][] = [];
    for (const item of evidence) {
      const parsed = json(item.bytes);
      if (!parsed.ok) return parsed;
      const receipt = decode('Receipt', parsed.value);
      if (!receipt.ok) return storeFail(receipt.error.code, 'host observation does not satisfy the Receipt codec');
      if (canonical(receipt.value.binding) !== canonical(item.ref.binding)) {
        return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'host observation differs from its artifact binding');
      }
      statuses.push(receipt.value.status === 'completed' && receipt.value.observability.length > 0 ? 'passed'
        : receipt.value.status === 'failed' || receipt.value.status === 'cancelled' ? 'failed' : 'unknown');
    }
    const status = statuses.includes('failed') ? 'failed' : statuses.includes('unknown') ? 'unknown' : 'passed';
    return storeOk(measurement('host', evidence.map(e => e.ref), status, status === 'passed' ? null : 'host-observation-incomplete',
      'Reconcile the actual host action and attach its observed receipt; do not repeat an unknown action blindly.'));
  });
}
