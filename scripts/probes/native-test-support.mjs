import fs from 'node:fs';
import path from 'node:path';

// Skip only an absent optional host installation. Present but invalid packages
// still reach the native fixture's version, loading and configuration assertions.
export function nativePackageSkipReason(packageRoot, packageName, rootVariable) {
  try {
    fs.statSync(path.join(packageRoot, 'package.json'));
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return `${packageName} native package is not installed (package.json missing); ${rootVariable} must point to an existing native installation`;
  }
}
