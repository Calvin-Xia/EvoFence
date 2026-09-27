/**
 * Pi tool strategy — the pure logic behind the `--adapter pi` tool-selection sidecar.
 *
 * DOMAIN: ctx_ext (the repository's own extension-loading surface). R1 conversion of
 * `src/lib/pi-tool-strategy.js`: same path, same export names and semantics. Everything here is
 * fail-open — no gate reads it — and the summary shape is the shared `PiToolStrategySummary`
 * contract from `src/types/`, so the exec sidecar reader and this module cannot drift apart.
 */
import { createHash } from 'node:crypto';
import type { AdapterPhase, PiToolStrategySummary, PiToolStrategyToolSummary } from '../types/index.js';

/** Version of the telemetry schema written by the extension and read by the adapter. */
export const PI_TOOL_STRATEGY_VERSION = 1;

const PHASE_ORDER: Readonly<Record<AdapterPhase, readonly string[]>> = Object.freeze({
  proposal: ['read', 'grep', 'find', 'ls'],
  implementation: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'powershell'],
});
const PHASE_ALLOWED_TOOLS: Readonly<Record<AdapterPhase, ReadonlySet<string> | null>> = Object.freeze({
  proposal: new Set(['read', 'grep', 'find', 'ls']),
  implementation: null,
});
const SAFE_PHASES: ReadonlySet<string> = new Set(Object.keys(PHASE_ORDER));
const SAFE_TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SIGNATURE_LENGTH = 16_384;
const MAX_TRACKED_FAILURES = 64;
const MAX_TRACKED_TOOLS = 64;
const MAX_TELEMETRY_BYTES = 256 * 1024;
const MAX_TELEMETRY_LINE_BYTES = 4096;

interface ToolCounts {
  calls: number;
  results: number;
  errors: number;
}

/** The events `createPiToolStrategy` accepts. Every field is optional and untrusted. */
interface ToolStrategyEvent {
  readonly toolName?: unknown;
  readonly input?: unknown;
  readonly isError?: unknown;
}

/** A blocked/allowed decision for one `tool_call` observation. */
export type PiToolStrategyDecision =
  | { blocked: false; toolName: string | null }
  | { blocked: true; toolName: string; reason: string };

/** The recovery feedback (if any) for one `tool_result` observation. */
export interface PiToolStrategyObservation {
  feedback: string | null;
  toolName: string | null;
  outcome: 'success' | 'error' | null;
}

/** The controller returned by {@link createPiToolStrategy}. */
export interface PiToolStrategy {
  readonly phase: AdapterPhase;
  readonly guidance: string;
  orderActiveTools(activeTools: readonly string[]): string[];
  onToolCall(event: unknown): PiToolStrategyDecision;
  onToolResult(event: unknown): PiToolStrategyObservation;
  summary(): PiToolStrategyControllerSummary;
}

/** What {@link PiToolStrategy.summary} reports for the phase that just finished. */
export interface PiToolStrategyControllerSummary {
  schema_version: typeof PI_TOOL_STRATEGY_VERSION;
  phase: AdapterPhase;
  tool_calls: number;
  tool_results: number;
  tool_errors: number;
  repeated_call_blocks: number;
  tools: PiToolStrategyToolSummary[];
}

export interface PiToolStrategyTelemetryOptions {
  phase?: string;
  maxBytes?: number;
}

function normalizePhase(phase: unknown): AdapterPhase {
  return typeof phase === 'string' && SAFE_PHASES.has(phase) ? (phase as AdapterPhase) : 'implementation';
}

function safeToolName(value: unknown): string | null {
  return typeof value === 'string' && SAFE_TOOL_NAME.test(value) ? value : null;
}

function callSignature(toolName: string, input: unknown): string | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input ?? null);
  } catch {
    return null;
  }
  if (typeof serialized !== 'string' || serialized.length > MAX_SIGNATURE_LENGTH) return null;
  return createHash('sha256').update(toolName).update('\0').update(serialized).digest('hex');
}

function increment(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : value;
}

function boundedSetAdd(set: Set<string>, value: string, limit: number): void {
  if (set.has(value)) return;
  set.add(value);
  while (set.size > limit) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

function appendToolCounter(map: Map<string, ToolCounts>, name: string, property: keyof ToolCounts): void {
  if (!map.has(name) && map.size >= MAX_TRACKED_TOOLS) return;
  const counts = map.get(name) ?? { calls: 0, results: 0, errors: 0 };
  counts[property] = increment(counts[property]);
  map.set(name, counts);
}

/** The guidance block injected into Pi's system prompt for a phase. */
export function piToolStrategyGuidance(phase: string): string {
  const stage = normalizePhase(phase);
  if (stage === 'proposal') {
    return 'EvoFence tool strategy for this proposal phase: inspect only with the currently active read-only tools. Do not edit project files or use shell commands. After a tool error, revise the inputs or choose another currently active read-only tool instead of repeating the identical call.';
  }
  return 'EvoFence tool strategy for this implementation phase: inspect the approved paths with available read/search tools, make the smallest approved edit, then run the narrowest relevant check. Use shell for concrete verification. After a tool error, revise the inputs or use another currently available tool instead of repeating the identical call.';
}

/** Build the per-invocation tool-strategy controller for one Pi phase. */
export function createPiToolStrategy(phase: string): PiToolStrategy {
  const stage = normalizePhase(phase);
  const priorities = new Map<string, number>(PHASE_ORDER[stage].map((name, index) => [name, index]));
  const failedSignatures = new Set<string>();
  const nudgedSignatures = new Set<string>();
  const failedTools = new Set<string>();
  const baselineIndexes = new Map<string, number>();
  const toolCounts = new Map<string, ToolCounts>();
  let toolCallCount = 0;
  let toolResultCount = 0;
  let toolErrorCount = 0;
  let repeatedCallBlockCount = 0;

  return {
    phase: stage,
    guidance: piToolStrategyGuidance(stage),
    orderActiveTools(activeTools: readonly string[]): string[] {
      if (!Array.isArray(activeTools) || !activeTools.every((name) => safeToolName(name))) {
        throw new TypeError('Pi returned an invalid active tool list.');
      }
      if (new Set(activeTools).size !== activeTools.length) {
        throw new TypeError('Pi returned duplicate active tools.');
      }
      // The first call happens at phase start with Pi's full active set. Keep those
      // indexes stable so recovery restores the original order of unprioritized tools.
      for (const name of activeTools) {
        if (!baselineIndexes.has(name)) baselineIndexes.set(name, baselineIndexes.size);
      }
      const allowedTools = PHASE_ALLOWED_TOOLS[stage];
      const selectedTools = allowedTools
        ? activeTools.filter((name) => allowedTools.has(name))
        : [...activeTools];
      if (selectedTools.length === 0 && activeTools.length > 0) {
        throw new Error(`No currently active ${stage} tools are allowed by the strategy.`);
      }
      return selectedTools.sort((left, right) => {
        const leftFailed = failedTools.has(left) ? 1 : 0;
        const rightFailed = failedTools.has(right) ? 1 : 0;
        if (leftFailed !== rightFailed) return leftFailed - rightFailed;
        const leftPriority = priorities.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = priorities.get(right) ?? Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return (baselineIndexes.get(left) ?? 0) - (baselineIndexes.get(right) ?? 0);
      });
    },
    onToolCall(event: unknown): PiToolStrategyDecision {
      const observation = event as ToolStrategyEvent | null | undefined;
      const toolName = safeToolName(observation?.toolName);
      if (!toolName) return { blocked: false, toolName: null };
      toolCallCount = increment(toolCallCount);
      appendToolCounter(toolCounts, toolName, 'calls');
      const signature = callSignature(toolName, observation?.input);
      if (signature && failedSignatures.has(signature) && !nudgedSignatures.has(signature)) {
        boundedSetAdd(nudgedSignatures, signature, MAX_TRACKED_FAILURES);
        failedTools.add(toolName);
        repeatedCallBlockCount = increment(repeatedCallBlockCount);
        return {
          blocked: true,
          toolName,
          reason: 'EvoFence tool strategy: this exact tool call already failed during the current Pi phase. Use the prior result to change the inputs or select a different currently available tool. The available tools and permissions are unchanged.',
        };
      }
      return { blocked: false, toolName };
    },
    onToolResult(event: unknown): PiToolStrategyObservation {
      const observation = event as ToolStrategyEvent;
      const toolName = safeToolName(observation.toolName);
      if (!toolName || typeof observation.isError !== 'boolean') return { feedback: null, toolName: null, outcome: null };
      toolResultCount = increment(toolResultCount);
      appendToolCounter(toolCounts, toolName, 'results');
      const signature = callSignature(toolName, observation.input);
      if (observation.isError) {
        toolErrorCount = increment(toolErrorCount);
        appendToolCounter(toolCounts, toolName, 'errors');
        if (signature) boundedSetAdd(failedSignatures, signature, MAX_TRACKED_FAILURES);
        failedTools.add(toolName);
        return {
          feedback: 'EvoFence tool strategy update: this tool returned an error. Use its result above to revise the inputs or choose another currently available tool. An identical retry will be blocked once; permissions and available tools are unchanged.',
          toolName,
          outcome: 'error',
        };
      }
      // A successful action changes the evidence available to the agent, so an earlier
      // failed call may become worth retrying after the agent responds to that evidence.
      failedSignatures.clear();
      nudgedSignatures.clear();
      failedTools.clear();
      return { feedback: null, toolName, outcome: 'success' };
    },
    summary(): PiToolStrategyControllerSummary {
      return {
        schema_version: PI_TOOL_STRATEGY_VERSION,
        phase: stage,
        tool_calls: toolCallCount,
        tool_results: toolResultCount,
        tool_errors: toolErrorCount,
        repeated_call_blocks: repeatedCallBlockCount,
        tools: [...toolCounts.entries()]
          .map(([name, counts]) => ({ name, ...counts }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      };
    },
  };
}

function safeToolOrder(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_TRACKED_TOOLS) return null;
  const order = value.map(safeToolName);
  if (order.some((name) => name === null) || new Set(order).size !== order.length) return null;
  return order as string[];
}

/** Fold a bounded sidecar log into the summary recorded on `adapter.finished`. */
export function summarizePiToolStrategyTelemetry(
  text: unknown,
  { phase, maxBytes = MAX_TELEMETRY_BYTES }: PiToolStrategyTelemetryOptions = {},
): PiToolStrategySummary {
  const stage = normalizePhase(phase);
  const summary: PiToolStrategySummary = {
    schema_version: PI_TOOL_STRATEGY_VERSION,
    status: 'unavailable',
    phase: stage,
    initial_tool_order: null,
    final_tool_order: null,
    tool_order_updates: 0,
    tool_calls: 0,
    tool_results: 0,
    tool_errors: 0,
    repeated_call_blocks: 0,
    controller_errors: 0,
    telemetry_truncated: false,
    agent_finished: false,
    tools: [],
  };
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) {
    summary.telemetry_truncated = typeof text === 'string';
    return summary;
  }

  let ready = false;
  const counts = new Map<string, PiToolStrategyToolSummary>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_TELEMETRY_LINE_BYTES) {
      summary.telemetry_truncated = true;
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      summary.telemetry_truncated = true;
      continue;
    }
    if (event?.schema_version !== PI_TOOL_STRATEGY_VERSION || event.phase !== stage) continue;
    if (event.type === 'ready') {
      const order = safeToolOrder(event.initial_order);
      if (!order) continue;
      ready = true;
      summary.initial_tool_order = order;
      summary.final_tool_order = order;
    } else if (event.type === 'tool_order') {
      const order = safeToolOrder(event.order);
      if (!order || !ready) continue;
      summary.final_tool_order = order;
      summary.tool_order_updates = increment(summary.tool_order_updates);
    } else if (event.type === 'tool_call') {
      const name = safeToolName(event.tool_name);
      if (!name) continue;
      summary.tool_calls = increment(summary.tool_calls);
      const tool = counts.get(name) ?? { name, calls: 0, results: 0, errors: 0 };
      tool.calls = increment(tool.calls);
      counts.set(name, tool);
      if (event.blocked_repeat === true) summary.repeated_call_blocks = increment(summary.repeated_call_blocks);
    } else if (event.type === 'tool_result') {
      const name = safeToolName(event.tool_name);
      if (!name || !['success', 'error'].includes(event.outcome as string)) continue;
      summary.tool_results = increment(summary.tool_results);
      const tool = counts.get(name) ?? { name, calls: 0, results: 0, errors: 0 };
      tool.results = increment(tool.results);
      if (event.outcome === 'error') {
        tool.errors = increment(tool.errors);
        summary.tool_errors = increment(summary.tool_errors);
      }
      counts.set(name, tool);
    } else if (event.type === 'controller_error') {
      summary.controller_errors = increment(summary.controller_errors);
    } else if (event.type === 'telemetry_truncated') {
      summary.telemetry_truncated = true;
    } else if (event.type === 'agent_end') {
      summary.agent_finished = true;
    }
  }
  summary.tools = [...counts.values()].sort((left, right) => left.name.localeCompare(right.name));
  summary.status = ready
    ? (summary.controller_errors || summary.telemetry_truncated || !summary.agent_finished ? 'degraded' : 'active')
    : (summary.controller_errors || summary.telemetry_truncated ? 'degraded' : 'unavailable');
  return summary;
}

/** The all-zero, `unavailable` summary every error path in the sidecar reader degrades to. */
export function unavailablePiToolStrategy(phase: string): PiToolStrategySummary {
  return {
    schema_version: PI_TOOL_STRATEGY_VERSION,
    status: 'unavailable',
    phase: normalizePhase(phase),
    initial_tool_order: null,
    final_tool_order: null,
    tool_order_updates: 0,
    tool_calls: 0,
    tool_results: 0,
    tool_errors: 0,
    repeated_call_blocks: 0,
    controller_errors: 0,
    telemetry_truncated: false,
    agent_finished: false,
    tools: [],
  };
}
