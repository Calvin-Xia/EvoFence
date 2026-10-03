// Checkout composition entry. L5 owns a future published core/host export surface.
import { createDshBinding } from '../../dist/hosts/dsh/index.js';

export const name = 'evofence-cordis-runtime';
export const inject = ['tools', 'agents', 'sessionProjections', 'evofenceRuntime'];

export function apply(ctx) {
  return createDshBinding(ctx, ctx.evofenceRuntime);
}
