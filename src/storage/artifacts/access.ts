/**
 * cp2 — access partition. Two independent axes decide whether a reference may be read.
 *
 * `SCHEMAS.md` states the axes are separate: "来源分区不由 visibility 推断". A13 adds that an
 * executor's read path must not contain a `final`/`held-out` artifact reference at all, and
 * `PrivacyPolicy` fixes `privateTests` to `evaluator-only`. So both `visibility` and `partition`
 * gate a read, and the only role allowed past `internal` is `evaluator`.
 *
 * The withheld side of a partition deliberately carries counts and reasons, never ids, locators or
 * digests: A13 forbids the executor-visible path from containing the reference, and an id is part of
 * the reference. A caller that needs to audit *what* was withheld asks as the `evaluator` audience,
 * which withholds no valid reference. Public classification and report entry points decode each
 * reference with the frozen codec before looking up either axis; malformed enums fail typed.
 */
import { decode } from '../../protocol/index.js';
import { storeOk } from '../index.js';
import type { StoreResult } from '../index.js';
import type { ArtifactRef, Audience, FeedbackPartition, Visibility } from './types.js';

/** Increasing sensitivity. Used only to compare against an audience ceiling. */
const VISIBILITY_RANK: Readonly<Record<Visibility, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  'held-out': 3,
  final: 4,
};

/**
 * The information ceiling per audience. `author` is the executing agent, `report` the default
 * report/feedback view, `asset-staging` the asset writer; all three stop at `internal`. `evaluator`
 * is the sole audience whose job is private tests and held-out/final data.
 */
const AUDIENCE_CEILING: Readonly<Record<Audience, Visibility>> = {
  author: 'internal',
  evaluator: 'final',
  report: 'internal',
  'asset-staging': 'internal',
};

/** Whether an audience may read artifacts from `held-out`/`final` source partitions at all. */
const AUDIENCE_SEES_RESTRICTED_PARTITION: Readonly<Record<Audience, boolean>> = {
  author: false,
  evaluator: true,
  report: false,
  'asset-staging': false,
};

/** Source partitions that never become author-visible feedback or asset material. */
const RESTRICTED_PARTITION: Readonly<Record<ArtifactRef['partition'], boolean>> = {
  train: false,
  dev: false,
  'held-out': true,
  final: true,
  'not-evaluation': false,
};

export function visibilityCeiling(audience: Audience): Visibility {
  return AUDIENCE_CEILING[audience];
}

export function isRestrictedPartition(ref: ArtifactRef): StoreResult<boolean> {
  const decoded = decode('ArtifactRef', ref);
  if (!decoded.ok) return decoded;
  return storeOk(RESTRICTED_PARTITION[ref.partition]);
}

/** Why a reference is withheld from `audience`; `'none'` means it may be read. */
export function withheldReason(ref: ArtifactRef, audience: Audience): StoreResult<'none' | 'visibility' | 'partition'> {
  const decoded = decode('ArtifactRef', ref);
  if (!decoded.ok) return decoded;
  if (VISIBILITY_RANK[ref.visibility] > VISIBILITY_RANK[AUDIENCE_CEILING[audience]]) return storeOk('visibility');
  if (!AUDIENCE_SEES_RESTRICTED_PARTITION[audience] && RESTRICTED_PARTITION[ref.partition]) return storeOk('partition');
  return storeOk('none');
}

/** Split a reference set into the part `audience` may read and a count of what it may not. */
export function partitionFeedback(refs: readonly ArtifactRef[], audience: Audience): StoreResult<FeedbackPartition> {
  const visible: ArtifactRef[] = [];
  let withheldVisibility = 0;
  let withheldPartition = 0;
  for (const ref of refs) {
    const reason = withheldReason(ref, audience);
    if (!reason.ok) return reason;
    if (reason.value === 'none') visible.push(ref);
    else if (reason.value === 'visibility') withheldVisibility += 1;
    else withheldPartition += 1;
  }
  return storeOk({ audience, visible, withheldVisibility, withheldPartition });
}

/** The default report view: everything an author-facing report may carry, and nothing else. */
export function defaultReportRefs(refs: readonly ArtifactRef[]): StoreResult<FeedbackPartition> {
  return partitionFeedback(refs, 'report');
}
