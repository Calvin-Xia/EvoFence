import { PI_CAPABILITIES, type CapabilityMatrix } from '../../runtime/host-port/index.js';

/** Session seams re-probed on 0.99.2; the frozen L1 matrix remains historical in core. */
export const PI_SESSION_CAPABILITIES: CapabilityMatrix = {
  ...PI_CAPABILITIES,
  sdkChildSessionIsolation: { status: 'unknown', limitation: '0.99.2 child sessions are outside this session lane; the delegation binding reports its own bounded partial for this key, never verified' },
  reasoningHighGuarantee: { status: 'unknown', limitation: 'payload high is observed; no server-tier guarantee re-probed' },
};
