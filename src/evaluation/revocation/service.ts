import { canonical, storeFail } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { createPromotionService } from '../../learning/promotion/index.js';
import type { QualificationContext } from '../../learning/assets/index.js';
import { records } from './journal.js';
import { begin } from './plan.js';
import { recover } from './recovery.js';
import type { MonitorInput, OrdinaryTaskView, RevocationPorts } from './types.js';

/** No constructor I/O. The promotion session is the sole durable truth; no timer or default host. */
export function createRevocationService(ports: RevocationPorts) {
  let tail = Promise.resolve();
  function serial<T>(action: () => T | Promise<T>): Promise<T> {
    const result = tail.then(action);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  const promotion = createPromotionService(ports.promotion);
  function ordinaryView(context: QualificationContext): OrdinaryTaskView {
    const versions = promotion.activatedVersions(context);
    return versions.ok ? { versions: versions.value, evolutionError: null } : { versions: [],
      evolutionError: storeFail(versions.error.code, 'learning context unavailable; ordinary task continues').error };
  }
  return {
    monitor(input: MonitorInput) {
      const copy = JSON.parse(canonical(input)) as MonitorInput;
      return serial(() => begin(ports, copy));
    },
    recover(requestId: string) { return serial(() => recover(ports, requestId)); },
    inspect() {
      const journal = ports.promotion.journal.exportSession(ports.promotion.sessionId);
      return journal.ok ? records(ports, journal.value) : journal;
    },
    ordinaryView,
    /** The owning runtime executes the already-authorized ordinary task, outside the learning queue. */
    runOrdinary<T>(context: QualificationContext, task: (view: OrdinaryTaskView) => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
      return task(ordinaryView(context));
    },
  };
}
