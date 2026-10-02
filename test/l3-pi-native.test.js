import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PI_VERSION, PI_SESSION_CAPABILITIES } from '../dist/hosts/pi/index.js';

function native(args) {
  const r = spawnSync(process.execPath, ['test/l3-pi-native-session.test.js', '--probe', ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(result.piVersion, '0.99.2'); assert.equal(result.paidRequests, 0);
  return result;
}
test('DoD1 real Pi 0.99.2 memory session is refused without a provider call', () => {
  assert.equal(native(['--memory-control']).checks.nativeMemorySessionRefused, true);
});
test('DoD2 real Pi 0.99.2 persistent kernel smoke, boundary continuation, reopen and abort', () => {
  const r = native([]);
  for (const name of ['existingPersistentSession', 'kernelReceiptApplied', 'contextAndResources',
    'blockedToolNeverExecutes', 'noEarlySettlement', 'continuation', 'settledReentryRefused',
    'waitsForAsyncSettledHook', 'diskRestore', 'unloadRetainsHost', 'abortNativeAck', 'abortUnknownSpend', 'abortDisconnected']) {
    assert.equal(r.checks[name], true, name);
  }
});
test('0.99.2 session capability view retains unknown for unprobed child and server reasoning', () => {
  assert.equal(PI_VERSION, '0.99.2');
  assert.equal(PI_SESSION_CAPABILITIES.sdkChildSessionIsolation.status, 'unknown');
  assert.equal(PI_SESSION_CAPABILITIES.reasoningHighGuarantee.status, 'unknown');
});
