import { verifyForConsumer } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import type { AssetRevision } from '../assets/index.js';
import type { ContextArtifact } from '../context/index.js';
import type { RetrievalInput, RetrievalPorts } from './types.js';

/** Current byte availability and external hydration admission reuse existing artifact contracts. */
export function admitMaterial(
  revision: AssetRevision, input: RetrievalInput, ports: RetrievalPorts,
): StoreResult<readonly ContextArtifact[]> {
  const c = revision.candidate;
  const material = verifyForConsumer({ role: 'asset', contentRefs: c.contentRefs,
    sourceTraces: c.sourceTraces, revokedDependencies: [], at: input.context.at }, ports.artifacts);
  if (!material.ok) return storeFail(material.error.code, 'retrieval material rejected');
  const items: ContextArtifact[] = [];
  for (const ref of c.contentRefs) {
    const item = input.materials.find(item => item.ref.id === ref.id);
    if (item === undefined) return storeFail('EFK_ARTIFACT_UNAVAILABLE', 'retrieval content has no explicit hydration');
    if (canonical(item.ref) !== canonical(ref) || !input.baseInputs.nodeInputRefs.some(r => canonical(r) === canonical(ref))) {
      return storeFail('EFK_GRAPH_INPUT_STALE', 'retrieval content differs from the registered or declared input');
    }
    // Experiences are evidence, never elevated human/host instructions or private candidate feedback.
    if (item.purpose !== 'evidence' && item.purpose !== 'handoff') {
      return storeFail('EFK_AUTHORITY_DENIED', 'asset content must be evidence or handoff');
    }
    if (item.bytes !== material.value.evidence.find(e => e.ref.id === ref.id)!.bytes) {
      return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', 'retrieval hydration differs from admitted immutable bytes');
    }
    items.push(item);
  }
  return storeOk(items);
}
