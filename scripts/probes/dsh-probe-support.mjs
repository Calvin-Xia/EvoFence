import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const expectedVersion = '0.2.0-rc.2';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const outputRoot = path.join(root, 'docs/evofence-harness-kernel/probes/dsh');
export const packageRoot = path.resolve(process.env.EVOFENCE_DSH_PACKAGE_ROOT
  ?? path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@deepseek-ai/dsh'));
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const outputFiles = new Set(['VERSION-PIN.json', 'HOST-MANIFEST.json', 'offline-trace.json', 'live-trace.json']);

// No scratch directory, session log, config dump, credential access, or budget mutation.
// Reject symlinked output ancestors instead of allowing the lane to escape its scope.
export function writeJson(name, value) {
  if (!outputFiles.has(name)) throw new Error('Output is outside the DSH lane allowlist');
  const parts = path.relative(root, outputRoot).split(path.sep);
  let current = root;
  for (const part of [...parts, name]) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Symlinked probe output is not authorized');
    }
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, name), JSON.stringify(value, null, 2) + '\n');
}

export const modules = [
  'dsh-agent', 'dsh-agent-loop', 'dsh-tools', 'dsh-experimental-agent-team',
  'dsh-session', 'dsh-session-projection', 'dsh-session-persistence-jsonl',
  'dsh-session-stats', 'dsh-llm', 'dsh-home-paths', 'dsh-system-prompt',
  'dsh-session-persistence', 'dsh-subagent', 'dsh-subagent-spawn-in-process',
  'dsh-subagent-fork-in-process', 'dsh-subagent-in-process-driver',
];

export function inspectInstallation() {
  const manifestFile = path.join(packageRoot, 'package.json');
  if (!fs.existsSync(manifestFile)) return { available: false, error: 'DSH_PACKAGE_MISSING', packageRoot };
  const pkg = readJson(manifestFile);
  if (pkg.name !== '@deepseek-ai/dsh') return { available: false, error: 'DSH_PACKAGE_IDENTITY_MISMATCH', packageRoot };
  const resolve = createRequire(manifestFile);
  const files = ['package.json', 'lib/bin.js'].filter(file => fs.existsSync(path.join(packageRoot, file)))
    .map(file => ({ package: pkg.name, version: pkg.version, file, sha256: digest(path.join(packageRoot, file)) }));
  const packages = [];
  for (const name of modules) {
    try {
      const file = resolve.resolve('@deepseek-ai/' + name + '/package.json');
      const info = readJson(file);
      const dir = path.dirname(file);
      packages.push({ name: info.name, version: info.version, directory: fs.realpathSync(dir) });
      for (const relative of ['package.json', 'lib/index.js', 'lib/types/index.d.ts',
        ...(name === 'dsh-agent' ? ['lib/types/runtime-types.d.ts'] : []),
        ...(name === 'dsh-llm' ? ['lib/types/types.d.ts'] : []),
        ...(name === 'dsh-subagent' ? ['lib/types/internal.js'] : []),
        ...(name === 'dsh-session-persistence' ? ['lib/types/handle.d.ts'] : [])]) {
        const target = path.join(dir, relative);
        if (fs.existsSync(target)) files.push({ package: info.name, version: info.version, file: relative, sha256: digest(target) });
      }
    } catch {
      packages.push({ name: '@deepseek-ai/' + name, status: 'unresolved' });
    }
  }
  return { available: true, packageRoot: fs.realpathSync(packageRoot), name: pkg.name, version: pkg.version, packages, files };
}

export function inspectDeclarations(installation) {
  const observations = [];
  const specs = [
    ['dsh-agent', 'lib/types/runtime-types.d.ts', ['agent/created', 'agent/disposed', 'agent/status', 'agent/pre-step', 'agent/request', 'agent/request-error', 'agent/assistant-stream', 'cancel(', 'whenIdle(']],
    ['dsh-agent', 'lib/types/index.d.ts', ['create(', 'resume(', 'currentInitiator(', 'requireInitiator(', 'withInitiator<']],
    ['dsh-tools', 'lib/types/index.d.ts', ['tools/pre-execute', 'tools/result', 'agent?: Agent', 'execute(', 'guard(guard:']],
    ['dsh-experimental-agent-team', 'lib/types/index.d.ts', ['membership(', 'tryMembership(', 'listMembers(', 'spawnTeammate(', 'sendMessage(', 'createTask(', 'getTask(', 'listTasks(', 'updateTask(', 'waitForChange(', 'interrupt(']],
    ['dsh-session-projection', 'lib/types/index.d.ts', ['stateVersion:', 'register<', 'restore(', 'apply(']],
    ['dsh-session-persistence-jsonl', 'lib/types/index.d.ts', ['Jsonl', 'open(']],
    ['dsh-llm', 'lib/types/types.d.ts', ['Usage', 'inputTokens', 'outputTokens', 'usage']],
  ];
  for (const [name, file, symbols] of specs) {
    const pkg = installation.packages?.find(item => item.name === '@deepseek-ai/' + name);
    const target = pkg?.directory && path.join(pkg.directory, file);
    const fileFound = Boolean(target && fs.existsSync(target));
    const lines = fileFound ? fs.readFileSync(target, 'utf8').split(/\r?\n/) : [];
    for (const symbol of symbols) {
      const matches = lines.flatMap((line, index) => line.includes(symbol) ? [index + 1] : []);
      observations.push({package: '@deepseek-ai/' + name, version: pkg?.version ?? null, file, symbol,
        lines: matches, symbolNotFound: matches.length === 0, fileFound,
        evidenceLevel: 'static-declaration-only', runtimeVerified: false});
    }
  }
  return observations;
}

export function inspectCliVersion() {
  const bin = path.join(packageRoot, 'lib/bin.js');
  if (!fs.existsSync(bin)) return { status: 'not-run', reason: 'CLI entry missing' };
  // Only launcher --version; profile boot/config introspection would read user state.
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const result = spawnSync(process.execPath, [bin, '--version'], {
    cwd: root, env, shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 16384,
  });
  const output = (result.stdout ?? '').trim();
  // Persist only semver; discard arbitrary stdout/stderr and never serialize errors.
  const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(output) ? output : null;
  return { command: 'node <installed-dsh>/lib/bin.js --version', exitCode: result.status,
    version, status: result.status === 0 && version ? 'observed' : 'failed',
    stderrSuppressed: Boolean(result.stderr), timedOut: result.error?.code === 'ETIMEDOUT' };
}

export async function inspectHome(installation) {
  const pkg = installation.packages?.find(item => item.name === '@deepseek-ai/dsh-home-paths');
  if (!pkg?.directory) return { status: 'unknown', reason: 'home-paths module unresolved' };
  const homePaths = await import(pathToFileURL(path.join(pkg.directory, 'lib/index.js')).href);
  const resolved = homePaths.resolveDshHome();
  return { status: 'observed', packageVersion: pkg.version, resolvedHome: resolved,
    source: process.env.DSH_HOME?.trim() ? 'DSH_HOME' : 'OS-home/.dsh',
    exists: fs.existsSync(resolved), homeDirStatOnly: true, dshHomeFileContentsRead: false,
    accessScope: 'Probe calls the installed home resolver and checks directory existence; dependency-internal credential access is not instrumented',
    targetVersionVerified: pkg.version === expectedVersion };
}

export function versionFailure(installation, cli) {
  if (!installation.available) return installation.error;
  if (installation.version !== expectedVersion || cli.version !== expectedVersion) return 'DSH_VERSION_MISMATCH';
  if (installation.packages.some(pkg => pkg.version !== expectedVersion)) return 'DSH_DEPENDENCY_VERSION_MISMATCH';
  return null;
}

export function refusePaidPath() {
  // This lane cannot mutate the shared MODEL-BUDGET.json. No credentials are loaded.
  return { status: 'not-run', reason: 'No paid dispatch implemented or authorized by this probe; native target-version admission must succeed and the shared budget owner must reserve first',
    paidRequests: 0, credentialsRead: false, budgetMutated: false };
}

export async function loadNative() {
  const require = createRequire(path.join(packageRoot, 'package.json'));
  const result = {};
  for (const name of ['cordis', ...modules, 'zod']) {
    const specifier = name === 'zod' ? name : '@deepseek-ai/' + name;
    result[name] = await import(pathToFileURL(require.resolve(specifier)).href);
  }
  return result;
}

export function provenance() {
  const logRoot = path.join(os.homedir(), 'AppData/Local/npm-cache/_logs');
  const evidence = [], missingEvidenceFiles = [];
  for (const filename of ['2026-10-01T10_00_16_268Z-debug-0.log', '2026-10-01T10_00_20_719Z-debug-0.log']) {
    const file = path.join(logRoot, filename);
    if (!fs.existsSync(file)) { missingEvidenceFiles.push(file); continue; }
    const match = fs.readFileSync(file, 'utf8').match(/verbose argv "i" "--global" "@deepseek-ai\/dsh@(latesr|latest)"/);
    // Capture only the allowlisted argv fragment, never whole npm logs.
    evidence.push({ file, sha256: digest(file), observedArgv: match ? ['i', '--global', '@deepseek-ai/dsh@' + match[1]] : null,
      capturedFragment: match?.[0] ?? null, evidenceLevel: 'selected-local-log-fragment' });
  }
  const logSequenceVerified = evidence.length === 2 && evidence.every(item => item.observedArgv);
  const integrationFile = path.join(root, 'integrations/deepseek-harness/package.json');
  const integration = readJson(integrationFile);
  return {
    drift: { observedExternalChange: true, from: '0.1.7-rc.1', to: expectedVersion,
      observationSource: 'Orchestrator session report; historical transition is not independently reproduced by this artifact',
      verificationStatus: logSequenceVerified ? 'verified-log-sequence' : 'unverified',
      beforeObservation: { localTime: '2026-10-01 17:57 Asia/Shanghai', source: 'Orchestrator reports prior dsh --version; not re-observed by this probe' },
      changeTime: logSequenceVerified ? '2026-10-01T10:00:20.719Z' : null, evidence, missingEvidenceFiles,
      collection: { npmLogPathsChecked: 2, npmLogsRead: evidence.length > 0, npmLogsReadCount: evidence.length,
        missingBeforeThisCollection: missingEvidenceFiles.length > 0,
        absenceObservedLocally: missingEvidenceFiles.length > 0,
        reportedCause: missingEvidenceFiles.length ? 'Independent review reports npm logs-max:10 rotation before collection; rotation policy not reverified by this probe' : null },
      attributedTo: 'external (user-side), not this fleet',
      attributionBasis: 'Orchestrator attribution; this probe executor ran no install command',
      note: logSequenceVerified ? 'Both selected local argv fragments captured; operator attribution remains an orchestrator report, not a conclusion from argv' : 'Historical npm argv and change time are unverified here; original logs are missing or unmatched, and this artifact contains no reconstructed raw log',
      reportedChange: { source: 'Orchestrator messages in this session, not recovered npm files',
        changeTime: '2026-10-01T10:00:20.719Z',
        commands: ['npm i --global @deepseek-ai/dsh@latesr', 'npm i --global @deepseek-ai/dsh@latest'],
        note: 'Orchestrator reports a four-second interval and infers a manual retry; neither argv nor operator identity is locally verified when evidence is unavailable' },
      targetChangeAuthorizedBy: 'User reply: 就用最新版; orchestrator explicitly selects 0.2.0-rc.2' },
    integrationGap: { file: 'integrations/deepseek-harness/package.json', sha256: digest(integrationFile),
      name: integration.name, version: integration.version, engines: integration.engines,
      peerDependencies: integration.peerDependencies, observedHostVersion: expectedVersion,
      compatibleWithDeclaredExactVersions: false, runtimeCompatibility: 'unverified', mutated: false },
  };
}

// The Pi lane is frozen. Read its keys to expose parity gaps without editing it.
export function compareFrozenPi(hostManifest, versionPin) {
  const lane = path.join(root, 'docs/evofence-harness-kernel/probes/pi');
  const hostFile = path.join(lane, 'HOST-MANIFEST.json'), versionFile = path.join(lane, 'VERSION-PIN.json');
  const statusVocabulary = ['absent', 'partial', 'unknown', 'verified'];
  const statusMeaning = {absent: 'Affirmatively unavailable in the probed composition; not inferred from lack of testing',
    partial: 'Named subset verified; full guarantee unverified', unknown: 'Unverified or insufficient evidence',
    verified: 'Listed checks establish the explicitly scoped guarantee at the stated evidence level'};
  if (!fs.existsSync(hostFile) || !fs.existsSync(versionFile)) return {statusVocabulary, statusMeaning,
    status: 'unknown', note: 'Frozen Pi artifacts unavailable in this copy; comparison not performed'};
  const piHost = readJson(hostFile), piPin = readJson(versionFile);
  const absentKeys = (a, b) => Object.keys(a).filter(key => !(key in b));
  return {statusVocabulary, statusMeaning, status: 'compared-read-only',
    sourceFiles: [{file: 'probes/pi/HOST-MANIFEST.json', sha256: digest(hostFile)}, {file: 'probes/pi/VERSION-PIN.json', sha256: digest(versionFile)}],
    hostCommonKeys: Object.keys(piHost), versionPinCommonKeys: Object.keys(piPin),
    dshMissingPiHostFields: absentKeys(piHost, hostManifest), dshMissingPiVersionFields: absentKeys(piPin, versionPin),
    dshMissingPiCapabilities: absentKeys(piHost.capabilities, hostManifest.capabilities),
    piMissingDshHostFields: absentKeys(hostManifest, piHost), piMissingDshVersionFields: absentKeys(versionPin, piPin),
    piMissingDshCapabilities: absentKeys(hostManifest.capabilities, piHost.capabilities),
    integrationGap: 'Pi lacks DSH-specific fields/capabilities; l1_api_freeze must define union keys and null/unknown handling. This probe does not modify the frozen Pi lane',
    evidenceDifference: 'Pi has real provider/disk evidence; DSH has synthetic adapter/memory storage. Shared status does not equal shared evidence strength'};
}
