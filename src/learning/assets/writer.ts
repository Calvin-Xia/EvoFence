import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';

export interface CandidateArea {
  readonly projectRoot: string; readonly stagingRoot: string; readonly userSkillRoots: readonly string[];
}
/** Component-aware containment after realpath; sibling prefixes are never treated as descendants. */
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
/**
 * Optional local writer, outside the core import closure. The caller owns serial lease/grant checks.
 * Roots/parents must exist; no directory creation, overwrite, user Skill edit or locator discovery.
 * Like the workspace port this is a same-user boundary, not an OS sandbox against concurrent tampering.
 */
export async function writeProjectCandidate(area: CandidateArea, relativePath: string, bytes: string): Promise<StoreResult<string>> {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).some(part => part === '..' || part === '' || part.includes(':')) || typeof bytes !== 'string') {
    return storeFail('EFK_ASSET_SCOPE_DENIED', 'candidate path must be relative to the authorized project staging area');
  }
  try {
    const project = await realpath(area.projectRoot);
    const staging = await realpath(area.stagingRoot);
    const readOnly = await Promise.all(area.userSkillRoots.map(root => realpath(root)));
    const target = path.resolve(staging, relativePath);
    const parent = await realpath(path.dirname(target));
    if (!inside(project, staging) || !inside(staging, parent) ||
      readOnly.some(root => inside(root, staging) || inside(root, parent))) {
      return storeFail('EFK_ASSET_SCOPE_DENIED', 'candidate write leaves project staging or reaches a read-only Skill source');
    }
    // Exclusive creation refuses existing files, symlinks and hardlinks without altering their bytes.
    const destination = path.join(parent, path.basename(target));
    const handle = await open(destination, 'wx');
    try { await handle.writeFile(bytes, 'utf8'); }
    finally { await handle.close(); }
    return storeOk(destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return storeFail('EFK_IDEMPOTENCY_COLLISION', 'candidate destination already exists; immutable source is preserved');
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(code as string)) {
      return storeFail('EFK_ARTIFACT_UNAVAILABLE', 'candidate staging path is unavailable');
    }
    throw error;
  }
}
