/** Validate caller-provided history before qualification consumes its trusted snapshot. */
import { readArtifact } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { readRegistryEvidence, validateDecisionTransition } from './decisions.js';
import { findRevision, sameRevision } from './identity.js';
import type { RegistryEvent, RegistryPorts, RegistrySnapshot } from './types.js';

export function validateRegistryHistory(snapshot: RegistrySnapshot,
  ports: Pick<RegistryPorts, 'artifacts'>): StoreResult<true> {
  const invalid = () => storeFail('EFK_ASSET_QUALIFICATION_INVALID', 'invalid asset registry history');
  const history: RegistryEvent[] = [];
  const staged: RegistrySnapshot['revisions'][number][] = [];
  for (const [sequence, event] of snapshot.history.entries()) {
    const revision = findRevision(snapshot, event.asset);
    if (event.sequence !== sequence || revision === undefined) return invalid();
    const prior: RegistrySnapshot = { revisions: staged, history };
    if (event.state === 'staged') {
      if (staged.some(r => r.candidate.asset.assetId === event.asset.assetId && r.candidate.asset.revision === event.asset.revision) ||
        event.evidenceRef !== null || event.context !== null || event.expiresAt !== null || event.at !== revision.createdAt ||
        !revision.candidate.dependencies.every(dep => findRevision(prior, dep) !== undefined)) return invalid();
      staged.push(revision);
    } else {
      if (event.evidenceRef === null || findRevision(prior, event.asset) === undefined) return invalid();
      if (event.state === 'revoked') {
        if (history.some(e => sameRevision(e.asset, event.asset) && e.state === 'revoked') ||
          event.context !== null || event.expiresAt !== null) return invalid();
        const evidence = readArtifact(event.evidenceRef, 'evaluator', event.at, ports.artifacts);
        if (!evidence.ok) return evidence;
        if (evidence.value.length === 0) return invalid();
      } else {
        const evidence = readRegistryEvidence(event.evidenceRef, 'DecisionRecord', event.at, ports);
        if (!evidence.ok) return evidence;
        const d = evidence.value;
        const transition = validateDecisionTransition(prior, event.asset, d.kind, event.state, event.evidenceRef);
        if (!transition.ok) return transition;
        if (d.outcome !== event.state || canonical(d.issuer) !== canonical(event.evidenceRef.producer) ||
          (event.state === 'active' ? event.context === null || event.context.at !== event.at : event.context !== null)) return invalid();
      }
    }
    history.push(event);
  }
  return staged.length === snapshot.revisions.length && staged.every((r, index) =>
    canonical(r) === canonical(snapshot.revisions[index])) ? storeOk(true) : invalid();
}
