/** Pinned TeamService seams. Agent objects remain host credentials, never serialized. */
import type { ArtifactRef, AuthorizedEffect, DelegationGrant, DelegationRequest, Effect,
  HostPort, HostResult, Receipt, Usage } from '../../runtime/host-port/index.js';
import type { RuntimeState } from '../../runtime/session/index.js';
import type { DshComposition, NativeAgent, NativeContext, NativeEvent, NativeExecution, BoardLink } from './types.js';

export interface TeamMember { readonly id: string; readonly name: string; readonly role: 'lead' | 'teammate' }
export interface TeamMembership {
  readonly root: NativeAgent; readonly id: string; readonly role: 'lead' | 'teammate'; readonly name: string;
}
export interface DelegationContext extends NativeContext {
  readonly agentTeams: {
    tryMembership(agent: NativeAgent): TeamMembership | undefined;
    listMembers(agent: NativeAgent): readonly TeamMember[];
    spawnTeammate(caller: NativeAgent, request: { name: string; description: string;
      prompt: { type: 'text'; text: string }[]; context: 'fresh'; provider: string; signal: AbortSignal }): Promise<{ member: TeamMember }>;
    sendMessage(caller: NativeAgent, request: { target: string; content: { type: 'text'; text: string }[];
      signal: AbortSignal }): Promise<{ messageId: string; status: 'accepted' | 'queued' }>;
    waitForChange(caller: NativeAgent, timeoutMs: number, signal: AbortSignal): Promise<{ timedOut: boolean }>;
    interrupt(caller: NativeAgent, targetName: string): { previousStatus: 'running' | 'inactive' };
    createTask(caller: NativeAgent, request: { subject: string; description: string; writeScopes: readonly string[] }): Promise<{ id: string; revision: number }>;
    updateTask(caller: NativeAgent, request: { taskId: string; expectedRevision: number; action: 'reassign' | 'release'; owner?: string }): Promise<unknown>;
  };
}
/** Supplied by the existing host permission composition, not by a model/tool argument. */
export interface TeamAuthority { readonly caller: NativeAgent; readonly grant: DelegationGrant }
export interface DelegationPlan {
  readonly target: { readonly kind: 'fresh'; readonly name: string; readonly description: string; readonly provider: 'spawn' }
    | { readonly kind: 'existing'; readonly childId: string };
  readonly child: DelegationRequest;
}
/** Dispatch evidence only: no scheduler, decisions or permission roots live here. */
export interface DelegationRecord {
  readonly key: string; readonly revision: number; readonly signature: string;
  readonly effect: Effect; readonly parentId: string; readonly teamId: string;
  readonly claimId: string; readonly plan: DelegationPlan; readonly grant: DelegationGrant;
  readonly phase: 'prepared' | 'running' | 'settled' | 'unknown';
  readonly childId: string | null; readonly childName: string; readonly fromSeq: number;
  readonly messageId: string | null; readonly taskId: string | null; readonly receipt: Receipt | null;
  readonly usage: readonly Usage[];
  readonly preSteps: number; readonly unconfirmed: boolean;
  readonly gatedCalls: readonly string[]; readonly resultCalls: readonly string[];
}
/** Injected durable CAS, scoped to this parent. No default in-memory backend is selected. */
export interface DelegationStore {
  get(key: string): HostResult<DelegationRecord | null>;
  list(): HostResult<readonly DelegationRecord[]>;
  put(record: DelegationRecord, expectedRevision: number | null): HostResult<void>;
}
export interface DelegationPorts {
  readonly base: HostPort;
  readonly composition: DshComposition;
  readonly store: DelegationStore;
  authority(): TeamAuthority;
  readKernel(): HostResult<RuntimeState>;
  plan(authorized: AuthorizedEffect): HostResult<DelegationPlan>;
  /** Existing host policies still run through next(); this adds the scoped request gate. */
  allowChild(grant: DelegationGrant, execution: NativeExecution): Promise<HostResult<void>>;
  /** Reads the real transcript even when a failed child has left the live Agent registry. */
  snapshot(childId: string): HostResult<ChildEvidence>;
  collect(child: ChildEvidence, effect: Effect, grant: DelegationGrant): HostResult<readonly ArtifactRef[]>;
  projectBoard(link: BoardLink): HostResult<void>;
}
export interface ChildEvidence { readonly id: string; readonly idle: boolean; readonly events: readonly NativeEvent[] }
export interface DshDelegationBinding { readonly host: HostPort; dispose(): void }
