/**
 * Pi tool strategy — the extension sidecar loaded by `evofence run --adapter pi`.
 *
 * DOMAIN: ctx_ext (the repository's own "extension loading surface" group). R1 conversion of
 * `src/lib/pi-tool-strategy-extension.js`: same path, same export names and semantics.
 *
 * RUNTIME NOTE: nothing imports this module statically. `src/lib/adapter.ts` resolves it as
 * `<dir of the running adapter.js>/pi-tool-strategy-extension.js` and passes it to the Pi
 * subprocess as `--extension <path>`. In the published package that resolves to
 * `dist/lib/pi-tool-strategy-extension.js`, i.e. the compiled JavaScript — Node never has to
 * load a `.ts` file at runtime. The project-level `.pi/extensions/evofence.js` entry is a
 * separate, untouched `.js` shell that re-exports `integrations/pi/evofence.js`.
 *
 * Every callback is fail-open: a controller or Pi-API error disables the strategy, restores the
 * original tool order and leaves Pi running with its normal tools.
 */
import { appendFile } from 'node:fs/promises';
import { createPiToolStrategy, PI_TOOL_STRATEGY_VERSION } from './pi-tool-strategy.js';
import type { PiToolStrategy } from './pi-tool-strategy.js';
import type { AdapterPhase } from '../types/index.js';

const MAX_TELEMETRY_RECORDS = 512;

/** The subset of the Pi extension API this sidecar uses. */
export interface PiExtensionHost {
  on(eventName: string, handler: (event: unknown) => unknown): unknown;
  getActiveTools(): string[];
  setActiveTools(toolNames: readonly string[]): void;
}

/** Options for {@link installPiToolStrategy}; both default to the adapter's env vars. */
export interface PiToolStrategyInstallOptions {
  phase?: string;
  logPath?: string;
}

function sameOrder(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((name, index) => name === right[index]);
}

function validOrder(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((name) => typeof name === 'string');
}

/** Register the strategy hooks on a Pi extension host. Never throws. */
export function installPiToolStrategy(pi: PiExtensionHost, {
  phase = process.env.EVOFENCE_PI_TOOL_STRATEGY_PHASE,
  logPath = process.env.EVOFENCE_PI_TOOL_STRATEGY_LOG,
}: PiToolStrategyInstallOptions = {}): void {
  let controller: PiToolStrategy | null;
  try {
    controller = createPiToolStrategy(phase ?? 'implementation');
  } catch {
    controller = null;
  }
  let disabled = controller === null;
  let initialActiveTools: string[] | null = null;
  let telemetryRecords = 0;
  const telemetryTarget = typeof logPath === 'string' && logPath.length > 0 ? logPath : null;
  let telemetryAvailable = telemetryTarget !== null;
  const disposers: Array<() => void> = [];

  function currentPhase(): AdapterPhase {
    return controller?.phase ?? 'implementation';
  }

  async function emit(type: string, fields: Record<string, unknown> = {}): Promise<boolean> {
    if (!telemetryAvailable || telemetryTarget === null) return false;
    if (telemetryRecords >= MAX_TELEMETRY_RECORDS) {
      telemetryAvailable = false;
      return false;
    }
    if (telemetryRecords === MAX_TELEMETRY_RECORDS - 1 && type !== 'telemetry_truncated') {
      const truncatedRecord = {
        schema_version: PI_TOOL_STRATEGY_VERSION,
        phase: currentPhase(),
        type: 'telemetry_truncated',
      };
      try {
        await appendFile(telemetryTarget, JSON.stringify(truncatedRecord) + '\n', 'utf8');
        telemetryRecords = MAX_TELEMETRY_RECORDS;
      } catch {
        telemetryAvailable = false;
        return false;
      }
      telemetryAvailable = false;
      return false;
    }
    const record = {
      schema_version: PI_TOOL_STRATEGY_VERSION,
      phase: currentPhase(),
      type,
      ...fields,
    };
    try {
      await appendFile(telemetryTarget, JSON.stringify(record) + '\n', 'utf8');
      telemetryRecords += 1;
      return true;
    } catch {
      telemetryAvailable = false;
      return false;
    }
  }

  async function restoreOriginalOrder(): Promise<void> {
    if (!initialActiveTools || !validOrder(initialActiveTools)) return;
    try {
      pi.setActiveTools(initialActiveTools);
    } catch {
      // The strategy is already disabled; restoring the original order is best effort.
    }
  }

  async function disable(eventName: string, { logError = true }: { logError?: boolean } = {}): Promise<void> {
    if (disabled) return;
    disabled = true;
    if (logError) {
      await emit('controller_error', { event: eventName });
    }
    await restoreOriginalOrder();
  }

  function register(eventName: string, handler: (event: unknown) => unknown): void {
    const dispose = pi.on(eventName, handler);
    if (typeof dispose === 'function') disposers.push(dispose as () => void);
  }

  try {
    register('before_agent_start', async (event) => {
      if (disabled || !controller) return;
      try {
        const activeTools = pi.getActiveTools();
        if (!validOrder(activeTools)) throw new TypeError('Pi returned an invalid active tool list.');
        initialActiveTools = [...activeTools];
        const initialOrder = controller.orderActiveTools(activeTools);
        if (!await emit('ready', {
          initial_order: initialOrder,
          original_order: activeTools,
        })) {
          await disable('telemetry_unavailable', { logError: false });
          return;
        }
        const orderChanged = !sameOrder(activeTools, initialOrder);
        if (orderChanged) pi.setActiveTools(initialOrder);
        if (orderChanged && !await emit('tool_order', { order: initialOrder })) {
          await disable('telemetry_unavailable', { logError: false });
          return;
        }
        const promptEvent = event as { systemPromptOptions?: { sections?: Record<string, string> } } | null | undefined;
        const sections = promptEvent?.systemPromptOptions?.sections;
        if (!sections || typeof sections !== 'object') throw new TypeError('Pi did not expose mutable system prompt sections.');
        sections.evofence_tool_strategy = controller.guidance;
      } catch {
        await disable('before_agent_start');
      }
    });

    register('tool_call', async (event) => {
      if (disabled || !controller) return;
      try {
        const decision = controller.onToolCall(event);
        let orderedTools: string[] | null = null;
        let orderChanged = false;
        if (decision.blocked) {
          const activeTools = pi.getActiveTools();
          if (!validOrder(activeTools)) throw new TypeError('Pi returned an invalid active tool list.');
          orderedTools = controller.orderActiveTools(activeTools);
          orderChanged = !sameOrder(activeTools, orderedTools);
          if (orderChanged) pi.setActiveTools(orderedTools);
        }
        if (!await emit('tool_call', {
          tool_name: decision.toolName,
          blocked_repeat: decision.blocked,
        })) {
          await disable('telemetry_unavailable', { logError: false });
          return;
        }
        if (orderChanged && !await emit('tool_order', { order: orderedTools })) {
          await disable('telemetry_unavailable', { logError: false });
          return;
        }
        if (decision.blocked) return { block: true, reason: decision.reason };
      } catch {
        await disable('tool_call');
      }
    });

    register('tool_result', async (event) => {
      if (disabled || !controller) return;
      try {
        const observation = controller.onToolResult(event);
        let orderedTools: string[] | null = null;
        let orderChanged = false;
        if (observation.toolName) {
          const activeTools = pi.getActiveTools();
          if (!validOrder(activeTools)) throw new TypeError('Pi returned an invalid active tool list.');
          orderedTools = controller.orderActiveTools(activeTools);
          orderChanged = !sameOrder(activeTools, orderedTools);
          if (orderChanged) pi.setActiveTools(orderedTools);
        }
        if (!await emit('tool_result', {
          tool_name: observation.toolName,
          outcome: observation.outcome,
        })) {
          await disable('telemetry_unavailable', { logError: false });
          return;
        }
        if (orderChanged && !await emit('tool_order', { order: orderedTools })) {
          await disable('telemetry_unavailable', { logError: false });
          return;
        }
        if (observation.feedback) {
          const resultEvent = event as { content: unknown };
          if (!Array.isArray(resultEvent.content)) throw new TypeError('Pi returned an invalid tool result.');
          return {
            content: [
              ...resultEvent.content,
              { type: 'text', text: observation.feedback },
            ],
          };
        }
      } catch {
        await disable('tool_result');
      }
    });

    register('agent_end', async () => {
      if (!await emit('agent_end')) {
        if (!disabled) await disable('telemetry_unavailable', { logError: false });
      }
    });
  } catch {
    disabled = true;
    for (const dispose of disposers) {
      try { dispose(); } catch {}
    }
  }
}

export default function evoFencePiToolStrategy(pi: PiExtensionHost): void {
  installPiToolStrategy(pi);
}
