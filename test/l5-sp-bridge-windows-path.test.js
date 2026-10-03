import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { fixture, witnesses, value } from './l5-sp-bridge-fixture.test.js';

// The Windows CI runner spells TEMP as an 8.3 short name (`C:\Users\RUNNER~1\AppData\Local\Temp`),
// so the real root and the requested child path differ textually while the child is still inside
// the root. Containment has to be judged on resolved forms, otherwise every bridge file operation
// is refused with EFK_AUTHORITY_DENIED on that runner and only there.
function shortAlias(target) {
  if (process.platform !== 'win32') return null;
  let out;
  try { out = execFileSync('cmd', ['/d', '/c', `for %I in (${target}) do @echo %~sI`], { encoding: 'utf8' }).trim(); }
  catch { return null; }
  if (out === '' || out.includes('"')) return null;
  try { if (realpathSync.native(out) !== realpathSync.native(target)) return null; }
  catch { return null; }
  return out;
}
test('cp3 a root reached through an 8.3 short-name ancestor still authorizes paths inside it', t => {
  const alias = shortAlias(tmpdir());
  if (alias === null) return t.skip('no 8.3 short-name spelling of the temp directory on this platform');
  const real = mkdtempSync(path.join(tmpdir(), 'efk-sp-short-'));
  try {
    const file = path.join(alias, path.basename(real), 'snapshot.yaml');
    const { delivery, bindings } = fixture(), { bridge, calls } = witnesses();
    writeFileSync(path.join(real, 'snapshot.yaml'), stringify(delivery).replace(/\n/g, '\r\n'));
    // Precondition: the spelling is non-canonical, so comparing the resolved root against the
    // unresolved child really does look like an escape. Without this the case proves nothing.
    if (realpathSync.native(file) === file) return t.skip('this temp directory has a canonical spelling');
    assert.ok(path.relative(realpathSync.native(real), file).startsWith('..'),
      'short-form path must differ from the resolved root');
    const scope = { root: path.join(alias, path.basename(real)) };
    // Import, export and re-import all go through the short-name spelling, exercising both the
    // input and the output branch of the containment check.
    const packet = value(bridge.importFile(file, scope, bindings));
    const output = path.join(scope.root, 'export.yaml');
    value(bridge.exportFile(packet, output, scope));
    assert.deepEqual(value(bridge.importFile(output, scope, bindings)), packet);
    assert.deepEqual(calls, { hostPort: 0, journal: 0, decisions: 0, grants: 0, claims: 0 });
  } finally {
    rmSync(real, { recursive: true, force: true });
  }
});
