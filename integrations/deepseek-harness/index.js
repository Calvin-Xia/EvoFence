// Checkout-only composition entry: it imports the repository's built `dist/`, which is gitignored,
// so a fresh clone cannot load this plugin before `npm run build`. L5 owns a future published
// core/host export surface; until then this file is not a package subpath.
import { createDshBinding } from '../../dist/hosts/dsh/index.js';

export const name = 'evofence-cordis-runtime';
export const inject = ['tools', 'agents', 'sessionProjections', 'evofenceRuntime'];

export function apply(ctx) {
  return createDshBinding(ctx, ctx.evofenceRuntime);
}
