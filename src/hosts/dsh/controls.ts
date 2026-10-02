/** Native operations receive the exact ToolRuntime caller, not a caller-selected session id. */
import { decode, fail } from '../../protocol/index.js';
import { err, type ArtifactRef, type HostResult } from '../../runtime/host-port/index.js';
import type { DshBinding, NativeContext, NativeExecution, NativeHelpers } from './types.js';

export function registerControls(ctx: NativeContext, helpers: NativeHelpers, binding: DshBinding): (() => void)[] {
  function caller(exec: NativeExecution): HostResult<string> {
    if (exec.agent === undefined || ctx.agents.get(exec.agent.id) !== exec.agent) {
      return err(fail('EFK_AUTHORITY_DENIED', 'EvoFence operation needs an exact live native caller'));
    }
    return { ok: true, value: exec.agent.id };
  }
  const operations: { name: string; description: string; parameters: Record<string, unknown>;
    run(id: string, args: unknown): Promise<HostResult<unknown>> }[] = [
    { name: 'evofence_status', description: 'View this session’s journal state and binding health.', parameters: {},
      run: async id => binding.status(id) },
    { name: 'evofence_continue', description: 'Queue one admitted EvoFence round in this same native session after the current turn settles.',
      parameters: {}, run: async id => binding.continue(id) },
    { name: 'evofence_pause', description: 'Pause EvoFence dispatch while ordinary host work continues.',
      parameters: { reason: { type: 'string', required: true } }, run: async (id, args) => binding.pause(id, (args as { reason: string }).reason) },
    { name: 'evofence_resume', description: 'Re-admit the paused journal with the explicit pinned manifest, advancing epoch without replaying unknown effects.',
      parameters: { manifestRefJson: { type: 'string', required: true } }, run: async (id, args) => {
        let input: unknown;
        try { input = JSON.parse((args as { manifestRefJson: string }).manifestRefJson); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return err(fail('EFK_SCHEMA_INVALID', 'manifest reference is not JSON'));
        }
        const ref = decode('ArtifactRef', input);
        return ref.ok ? binding.resume(id, ref.value as ArtifactRef) : ref;
      } },
    { name: 'evofence_reconcile', description: 'Reconcile observed outcomes; never repeat an unknown native action.',
      parameters: {}, run: id => binding.reconcile(id) },
    { name: 'evofence_evaluate', description: 'Submit this effect to the registered independent task evaluator.',
      parameters: { effectId: { type: 'string', required: true } },
      run: (id, args) => binding.evaluate(id, (args as { effectId: string }).effectId) },
  ];
  return operations.map(operation => ctx.tools.register(helpers.defineTool({ name: operation.name,
    description: operation.description, parameters: operation.parameters,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const identified = caller(exec);
      return JSON.stringify(identified.ok ? await operation.run(identified.value, args) : identified);
    } })));
}
