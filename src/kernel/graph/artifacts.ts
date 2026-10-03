/**
 * `data` edge binding (`SCHEMAS.md §3`, `SEMANTICS.md §3.1`).
 *
 * A `data` edge is a blocking consumer with an explicit selector: the producer's designated output
 * schema (`expect`) must be satisfiable, and either the artifact is already bound or it is a
 * declared-but-not-yet-produced output (`artifact: null`). The selector is matched against the
 * producer's `outputSchemas` **uniquely** — no "take the latest", no "guess from the name".
 *
 * Re-binding to a new digest is a deliberate act: it happens through a `GraphPatch` that replaces
 * the edge, which is why nothing here ever rewrites an edge. `consumable` only *reports* whether
 * the current binding still holds; a re-executed producer with a fresh digest makes the consumer
 * `waiting` rather than silently following it.
 */
import { fail } from '../../protocol/index.js';
import type { ArtifactRef, EdgeSpec, GraphIssue, NodeSpec, SchemaRef } from './types.js';

/** Two `SchemaRef`s address the same schema (name, exact version, content digest). */
export function sameSchema(left: SchemaRef, right: SchemaRef): boolean {
  return left.name === right.name && left.version === right.version && left.digest === right.digest;
}

function issue(code: GraphIssue['code'], message: string): GraphIssue {
  return { check: 4, code, message };
}

/**
 * Check 4 for one `data` edge: the expect selector is present, and it resolves to exactly one
 * declared producer output (for a future artifact) or to a matching, producer-owned binding.
 */
export function dataEdgeIssues(edge: EdgeSpec, producer: NodeSpec): readonly GraphIssue[] {
  const expect = edge.expect;
  if (expect === null) {
    return [issue('EFK_SCHEMA_INVALID', `data edge ${edge.edgeId}: expect must be non-null`)];
  }

  if (edge.artifact === null) {
    const candidates = producer.outputSchemas.filter((schema) => sameSchema(schema, expect));
    if (candidates.length !== 1) {
      return [
        issue(
          'EFK_GRAPH_INPUT_STALE',
          `data edge ${edge.edgeId}: selector ${expect.name}@${expect.version} matches ${candidates.length} of ` +
            `${producer.nodeId}'s outputSchemas; exactly one is required`,
        ),
      ];
    }
    return [];
  }

  const artifact: ArtifactRef = edge.artifact;
  const issues: GraphIssue[] = [];
  if (artifact.binding === null || artifact.binding.nodeId !== edge.from) {
    issues.push(
      issue(
        'EFK_ARTIFACT_BINDING_MISMATCH',
        `data edge ${edge.edgeId}: bound artifact is not produced by ${edge.from}`,
      ),
    );
  }
  if (!sameSchema(expect, artifact.schema)) {
    issues.push(
      issue(
        'EFK_ARTIFACT_BINDING_MISMATCH',
        `data edge ${edge.edgeId}: bound artifact schema does not satisfy expect ${expect.name}@${expect.version}`,
      ),
    );
  }
  return issues;
}

/**
 * Whether a consumer may read its `data` input right now.
 *
 * A declared-but-not-yet-produced edge (`artifact: null`) becomes consumable as soon as the
 * producer emits an artifact matching the `expect` selector; a bound edge additionally requires the
 * same digest. Re-producing a different digest never matches an old binding, so the caller must
 * rebind explicitly rather than follow the newest bytes.
 */
export function consumable(edge: EdgeSpec, produced: ArtifactRef | null): boolean {
  const expect = edge.expect;
  if (expect === null || produced === null) return false;
  if (!sameSchema(expect, produced.schema)) return false;
  const bound = edge.artifact;
  return bound === null || produced.digest === bound.digest;
}

/** The repair path for a stale binding: a patch replaces the edge; this only names the refusal. */
export function staleBinding(edge: EdgeSpec): GraphIssue {
  return issue('EFK_GRAPH_INPUT_STALE', `data edge ${edge.edgeId}: bound digest is not the produced one; rebind explicitly`);
}

/** The error envelope a stale or missing input maps to when a node cannot become ready. */
export function inputStale(edge: EdgeSpec): ReturnType<typeof fail> {
  return fail('EFK_GRAPH_INPUT_STALE', `data edge ${edge.edgeId}: input not consumable; explicit rebind required`);
}
