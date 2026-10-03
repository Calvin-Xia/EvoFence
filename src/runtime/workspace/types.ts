/** In-process WorkspacePort contract; no new wire envelope or session journal. */
import type { ArtifactRef, Binding } from '../../kernel/artifacts/types.js';
import type { StoreResult, Receipt } from '../../kernel/store/contracts.js';
import type { AuthorizedEffect, DelegationGrant, Scope } from '../host-port/types.js';

export type { ArtifactRef, Binding, StoreResult, Receipt, AuthorizedEffect, DelegationGrant, Scope };
export interface WorkspaceBase {
  readonly workspaceId: string;
  readonly revision: string;
  readonly digest: string;
  readonly isolation: 'git-worktree' | 'versioned-directory';
  readonly osSandbox: false;
}
/** Text files only. Modes participate in content identity; links/devices are refused. */
export interface WorkspaceFile { readonly content: string; readonly executable: boolean }
export type WorkspaceFiles = Readonly<Record<string, WorkspaceFile>>;
/** Frozen Scope uses named resource IDs. The host supplies their explicit relative path resolution. */
export type WorkspaceResources = Readonly<Record<string, readonly string[]>>;
export interface WorkspaceChange { readonly path: string; readonly file: WorkspaceFile | null }
export interface StageRequest {
  readonly base: WorkspaceBase;
  readonly binding: Binding;
  readonly grant: DelegationGrant;
}
export interface WorkspaceStage extends StageRequest { readonly stageId: string }
export interface WorkspacePatch {
  readonly base: WorkspaceBase;
  readonly binding: Binding;
  readonly scope: Scope;
  readonly changes: readonly WorkspaceChange[];
}
export interface WorkspaceConflict {
  readonly action: 'rebase/replan';
  readonly files: readonly string[];
  readonly proposedBase: WorkspaceBase;
  readonly currentBase: WorkspaceBase;
}
/** Host observation, not an ActivationDecision or a global active flag. */
export interface WorkspaceApplication {
  readonly effectId: string;
  readonly operation: 'apply' | 'undo';
  readonly before: WorkspaceBase;
  readonly after: WorkspaceBase | null;
  readonly actualStatus: 'applied' | 'failed' | 'not-executed';
  readonly patchRef: ArtifactRef | null;
  readonly osSandbox: false;
}
export type WorkspaceOutcome =
  | { readonly disposition: 'applied' | 'undone' | 'failed' | 'not-executed'; readonly receipt: Receipt; readonly evidence: ArtifactRef }
  | { readonly disposition: 'rebase/replan'; readonly conflict: WorkspaceConflict }
  | { readonly disposition: 'unknown'; readonly effectId: string; readonly observed: WorkspaceBase };

export interface WorkspacePort {
  base(): Promise<StoreResult<WorkspaceBase>>;
  stage(request: StageRequest): Promise<StoreResult<WorkspaceStage>>;
  read(stage: WorkspaceStage, path: string): Promise<StoreResult<WorkspaceFile | null>>;
  write(stage: WorkspaceStage, change: WorkspaceChange): Promise<StoreResult<void>>;
  diff(stage: WorkspaceStage): Promise<StoreResult<readonly WorkspaceChange[]>>;
  seal(stage: WorkspaceStage): Promise<StoreResult<ArtifactRef>>;
  apply(authorized: AuthorizedEffect, patch: ArtifactRef): Promise<StoreResult<WorkspaceOutcome>>;
  undo(authorized: AuthorizedEffect, evidence: ArtifactRef): Promise<StoreResult<WorkspaceOutcome>>;
  reconcile(sessionId: string, effectId: string): Promise<StoreResult<WorkspaceOutcome>>;
}
