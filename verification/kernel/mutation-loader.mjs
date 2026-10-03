import { mutations } from './mutations.mjs';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const selected = mutations.find(m => m.id === process.env.EFK_VERIFICATION_MUTATION);
  if (selected && url.endsWith('/' + selected.file)) {
    let source = String(result.source);
    for (const [from, to, expectedCount] of selected.edits) {
      const count = source.split(from).length - 1;
      if (count !== expectedCount) throw new Error(`mutation drift: ${selected.id}: expected ${expectedCount} sites, got ${count}`);
      source = source.split(from).join(to);
    }
    process.stderr.write(`[mutation-applied:${selected.id}] ${selected.file}\n`);
    return { ...result, source };
  }
  return result;
}
