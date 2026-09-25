import { appendFile } from 'node:fs/promises';
import { createPiToolStrategy, PI_TOOL_STRATEGY_VERSION } from './pi-tool-strategy.js';

const MAX_TELEMETRY_RECORDS = 512;

function sameOrder(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((name, index) => name === right[index]);
}

function validOrder(value) {
  return Array.isArray(value) && value.every((name) => typeof name === 'string');
}

export function installPiToolStrategy(pi, {
  phase = process.env.EVOFENCE_PI_TOOL_STRATEGY_PHASE,
  logPath = process.env.EVOFENCE_PI_TOOL_STRATEGY_LOG,
} = {}) {
  let controller;
  try {
    controller = createPiToolStrategy(phase);
  } catch {
    controller = null;
  }
  let disabled = controller === null;
  let initialActiveTools = null;
  let telemetryRecords = 0;
  let telemetryAvailable = typeof logPath === 'string' && logPath.length > 0;
  const disposers = [];

  async function emit(type, fields = {}) {
    if (!telemetryAvailable) return false;
    if (telemetryRecords >= MAX_TELEMETRY_RECORDS) {
      telemetryAvailable = false;
      return false;
    }
    if (telemetryRecords === MAX_TELEMETRY_RECORDS - 1 && type !== 'telemetry_truncated') {
      const truncatedRecord = {
        schema_version: PI_TOOL_STRATEGY_VERSION,
        phase: controller?.phase ?? 'implementation',
        type: 'telemetry_truncated',
      };
      try {
        await appendFile(logPath, JSON.stringify(truncatedRecord) + '\n', 'utf8');
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
      phase: controller?.phase ?? 'implementation',
      type,
      ...fields,
    };
    try {
      await appendFile(logPath, JSON.stringify(record) + '\n', 'utf8');
      telemetryRecords += 1;
      return true;
    } catch {
      telemetryAvailable = false;
      return false;
    }
  }

  async function restoreOriginalOrder() {
    if (!initialActiveTools || !validOrder(initialActiveTools)) return;
    try {
      pi.setActiveTools(initialActiveTools);
    } catch {
      // The strategy is already disabled; restoring the original order is best effort.
    }
  }

  async function disable(eventName, { logError = true } = {}) {
    if (disabled) return;
    disabled = true;
    if (logError) {
      await emit('controller_error', { event: eventName });
    }
    await restoreOriginalOrder();
  }

  function register(eventName, handler) {
    const dispose = pi.on(eventName, handler);
    if (typeof dispose === 'function') disposers.push(dispose);
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
        const sections = event?.systemPromptOptions?.sections;
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
        let orderedTools = null;
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
        let orderedTools = null;
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
          if (!Array.isArray(event.content)) throw new TypeError('Pi returned an invalid tool result.');
          return {
            content: [
              ...event.content,
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

export default function evoFencePiToolStrategy(pi) {
  installPiToolStrategy(pi);
}
