/** Optional concrete adapters. This barrel must never be imported/re-exported by core. */
export { createWorkspaceProvider } from './provider.js';
export { createGitWorkspaceDriver } from './git.js';
export { createFilesystemWorkspaceDriver, initializeFilesystemWorkspace } from './filesystem.js';
export type { WorkspaceOptions, WorkspaceDriver, FaultPoint } from './types.js';
export type { GitWorkspaceOptions } from './git.js';
