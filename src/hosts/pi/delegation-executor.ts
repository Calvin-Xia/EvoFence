import { fail } from '../../protocol/index.js';
import { err, ok, type HostResult } from '../../runtime/host-port/index.js';
import { bindPiSession } from './binding.js';
import type { PiBinding, PiExtensionAPI, PiOptions, PiSession } from './types.js';
import type { PiChildExecutor, PiChildSpec } from './delegation-types.js';

export interface PiNativeChildSession extends PiSession {
  readonly model: { readonly provider: string; readonly id: string } | undefined;
  readonly thinkingLevel: string;
  dispose(): void;
}
export interface PiChildOptions extends Omit<PiOptions, 'kernelSessionId' | 'session'> {
  readonly session: () => PiNativeChildSession;
}
/** Production SDK child executor: the explicit host factory owns creation/reopening and transport.
 * No SDK discovery/default ModelRuntime or credentials are loaded here. Native model checks occur
 * after session_start, because Pi loads the extension factory before returning AgentSession.
 */
export function bindPiChildExecutor(api: PiExtensionAPI, spec: PiChildSpec, options: PiChildOptions):
  HostResult<PiChildExecutor & { readonly binding: PiBinding }> {
  if (options.hostSessionId === spec.parentSessionId) {
    return err(fail('EFK_HOST_SESSION_MISMATCH', 'child executor cannot own the parent SDK session'));
  }
  const bound = bindPiSession(api, { ...options, kernelSessionId: spec.kernelSessionId });
  if (!bound.ok) return bound;
  const binding = bound.value;
  return ok({ sessionId: options.hostSessionId, binding, host: { ...binding.host,
    async execute(authorized) {
      const native = options.session();
      if (native.model?.provider !== spec.model.provider || native.model.id !== spec.model.modelId
        || native.thinkingLevel !== spec.model.thinkingLevel) {
        return err(fail('EFK_SOURCE_PIN_DRIFT', 'native child model/reasoning differs from its inherited configuration'));
      }
      return binding.host.execute(authorized);
    } },
    dispose() {
      binding.unload();
      const native = options.session();
      if (native.sessionManager.getSessionId() === options.hostSessionId) native.dispose();
    } });
}
