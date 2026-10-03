import type { ArtifactStore, EventStore, StoreResult, Receipt } from '../kernel/store/contracts.js';
import type { DigestPort } from '../kernel/store/identity.js';
import type { Clock, AuthorizedEffect } from '../runtime/host-port/types.js';
import type { ArtifactRef, WorkspaceApplication, WorkspaceBase, WorkspaceFiles, WorkspaceStage, WorkspaceResources } from '../runtime/workspace/types.js';

export type FaultPoint = 'claimed' | 'candidate-file' | 'prepared' | 'published' | 'receipt-saved';
export interface WorkspaceOptions {
  readonly driver: WorkspaceDriver;
  readonly store: EventStore;
  readonly artifacts: ArtifactStore;
  readonly digest: DigestPort;
  readonly clock: Clock;
  readonly resourcePaths: WorkspaceResources;
  /** Explicit test/host hook. Exceptions remain observable through a typed host failure. */
  readonly checkpoint?: (point: FaultPoint) => Promise<void>;
}
export interface WorkspaceDriver {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly controlDir: string;
  current(): Promise<WorkspaceBase>;
  files(base: WorkspaceBase): Promise<WorkspaceFiles>;
  stage(base: WorkspaceBase, id: string): Promise<string>;
  prepare(before: WorkspaceBase, files: WorkspaceFiles, id: string, checkpoint: WorkspaceOptions['checkpoint']): Promise<WorkspaceBase>;
  publish(before: WorkspaceBase, after: WorkspaceBase): Promise<StoreResult<void>>;
}
/** Operational host record, not a second session/outbox state machine. */
export interface ApplicationRecord {
  readonly key: string;
  readonly authorized: AuthorizedEffect;
  readonly operation: 'apply' | 'undo';
  readonly before: WorkspaceBase;
  readonly after: WorkspaceBase | null;
  readonly patchRef: ArtifactRef | null;
  readonly completed: { readonly receipt: Receipt; readonly evidence: ArtifactRef; readonly application: WorkspaceApplication } | null;
}
export interface StageRecord { readonly stage: WorkspaceStage; readonly root: string; readonly sealed: ArtifactRef | null }
