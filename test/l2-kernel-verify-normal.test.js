import test from 'node:test';
// The scenarios import the production application service exclusively from this build's dist/**.
import { ordinary, repair, delegation } from '../verification/kernel/normal.mjs';
test('kernel verify cp1 ordinary atomic intention -> receipt -> evaluation -> serialized close', ordinary);
test('kernel verify cp1 private test failure -> bounded repair -> success preserves failure', repair);
test('kernel verify cp1 dynamic delegate uses narrowed grant and shared budget pool', delegation);
