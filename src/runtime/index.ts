/** Injected runtime domains; re-export the existing production SessionService. */
export * as protocol from '../protocol/index.js';
export * as kernel from '../kernel/index.js';
export * as hostPort from './host-port/index.js';
export * as session from './session/index.js';
export * as workspace from './workspace/index.js';
export { createSessionService } from './session/index.js';
export type { SessionPorts, SessionService } from './session/index.js';
