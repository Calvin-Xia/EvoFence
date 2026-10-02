/** Fault containment is part of DoD2: observable refusal and durable pause, ordinary work stays live. */
import { fail, type ErrorEnvelope } from '../../protocol/index.js';
import { err, ok, type HostResult } from '../../runtime/host-port/index.js';
import { identity } from './mapping.js';
import type { DshComposition, DshObservation, DshSession } from './types.js';

export function stopEvolution(session: DshSession, composition: DshComposition, error: ErrorEnvelope): void {
  session.fault = error;
  try { pauseJournal(session, composition, error); }
  catch {
    // A real store/port exception can prevent a durable pause. The local refusal remains armed,
    // and this explicit diagnostic reports that restart must re-admit/reconcile the journal.
    session.pauseError = fail('EFK_EFFECT_UNKNOWN', 'journal pause failed; local evolution refusal remains active', [session.agent.id]);
  }
}
function pauseJournal(session: DshSession, composition: DshComposition, error: ErrorEnvelope): void {
  const state = session.runtime.read(session.request.sessionId);
  if (!state.ok) { session.pauseError = state.error; return; }
  if (state.value.dispatchMode !== 'active') return;
  const pause = session.runtime.pause(session.request.sessionId, {
    commandId: identity(composition, 'dsh-pause', [session.agent.id, state.value.revision, error.code]),
    expectedRevision: state.value.revision, reason: error.code,
  });
  if (!pause.ok) session.pauseError = pause.error;
}
export function unexpected(session: DshSession, composition: DshComposition, stage: string): ErrorEnvelope {
  // Foreign exceptions may contain prompts/credentials. Retain the stage and typed refusal only.
  const error = fail('EFK_EFFECT_UNKNOWN', `DSH binding failed at ${stage}; evolution paused`, [session.agent.id]);
  stopEvolution(session, composition, error);
  return error;
}
export function emitObservation(session: DshSession, composition: DshComposition, observation: DshObservation): void {
  session.observations.push(observation);
  try { composition.onObservation(observation); }
  catch { unexpected(session, composition, observation.type); }
}
export function healthy(session: DshSession): HostResult<void> {
  if (session.disposed) return err(fail('EFK_HOST_SESSION_MISMATCH', 'DSH binding has been disposed', [session.agent.id]));
  return session.fault === null ? ok(undefined) : err(session.fault);
}
