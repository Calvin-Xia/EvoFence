import { storeFail, storeOk } from '../../kernel/store/contracts.js';
import type { StoreResult } from '../../kernel/store/contracts.js';
import type { BoundedContextPacket, ContextPacket, ContextPorts, WindowBudget } from './types.js';
import { canonical as canonicalContext } from '../../kernel/store/identity.js';

/** Key order is canonical; array order is the committed declaration order, never locator/latest. */
export { canonicalContext };

/** Count the entire dispatch, including task, immutable references and audit. No length heuristic. */
export function fitWindow(
  packet: ContextPacket, budget: WindowBudget, tokenLimit: number, ports: ContextPorts,
): StoreResult<BoundedContextPacket> {
  function measure(current: ContextPacket, compressed: boolean): StoreResult<BoundedContextPacket> {
    const serialized = canonicalContext(current);
    const tokenCount = ports.tokenizer.countTokens(serialized);
    if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
      return storeFail('EFK_SCHEMA_INVALID', 'tokenizer must return a nonnegative safe integer');
    }
    return storeOk({ packet: current, serialized, tokenCount, tokenLimit, tokenizerId: ports.tokenizer.id, compressed });
  }
  const full = measure(packet, false);
  if (!full.ok) return full;
  if (full.value.tokenCount <= tokenLimit) return full;
  if (budget.strategy === 'compact') {
    // Re-measure every candidate: tokenizers need not be monotonic in character prefix length.
    for (let chars = budget.excerptChars; ; chars = Math.floor(chars / 2)) {
      const compact: ContextPacket = {
        ...packet,
        entries: packet.entries.map(entry => {
          if (entry.purpose === 'human-instruction' || entry.purpose === 'host-instruction') return entry;
          const text = Array.from(entry.text).slice(0, chars).join('');
          return { ...entry, text, mode: text === entry.text ? 'full' : text.length === 0 ? 'reference' : 'excerpt' };
        }),
      };
      const candidate = measure(compact, true);
      if (!candidate.ok) return candidate;
      if (candidate.value.tokenCount <= tokenLimit) return candidate;
      if (chars === 0) break;
    }
  }
  return storeFail('EFK_BUDGET_EXHAUSTED', 'context references, audit and retained instructions cannot fit the token limit');
}
