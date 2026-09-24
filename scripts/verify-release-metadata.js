import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyReleaseMetadata({ version, releaseTag, releaseIsPrerelease }) {
  const releaseVersion = releaseTag.replace(/^v/, '');
  const packageIsPrerelease = version.split('+', 1)[0].includes('-');

  if (releaseVersion !== version) {
    throw new Error(`Release tag ${releaseTag} does not match package version ${version}`);
  }

  if (releaseIsPrerelease !== packageIsPrerelease) {
    throw new Error('GitHub Release prerelease status must match the package SemVer version');
  }
}

function run() {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const releaseTag = process.env.RELEASE_TAG;
  const releaseFlag = process.env.RELEASE_IS_PRERELEASE;
  if (!releaseTag || !['true', 'false'].includes(releaseFlag)) {
    throw new Error('RELEASE_TAG and RELEASE_IS_PRERELEASE must be provided by the GitHub Release event');
  }
  verifyReleaseMetadata({ version, releaseTag, releaseIsPrerelease: releaseFlag === 'true' });
  process.stdout.write(`Release ${releaseTag} matches package ${version}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
