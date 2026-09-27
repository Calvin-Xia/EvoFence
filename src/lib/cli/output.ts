/**
 * Output helpers: the JSON document, the failure contract (text and JSON), and run progress.
 *
 * DOMAIN: CLI (node `l2_cli`). The failure contract is the one `l2_report` defined and `l2_cli`
 * now applies to EVERY command (handoff 1, ADR-0003):
 *
 *   text mode — `<[CODE] >message` on stderr, plus `details` when `EVOFENCE_DEBUG` is set;
 *   JSON mode — ONE object on stderr, stdout byte-empty:
 *               {"error":{"code": string|null, "message": string, "details"?: unknown}}
 *
 * `code` is `null` only for a thrown value that is not an `EvoFenceError`.
 */
import process from 'node:process';

export type Write = (text: string) => void;

/** Pretty-printed single JSON document with a trailing newline. */
export function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The documented `--json` SUCCESS envelope for a command that writes a file to disk (F8c).
 *
 * In `--json` mode stdout carries the JSON document and NOTHING else — the human-readable
 * `Written to <path>` line is text-mode only — so a write-file command says where it landed in an
 * envelope instead. `written` is the repo-relative POSIX path; `bytes` is the UTF-8 byte length of
 * the content written.
 */
export interface CliWritePayload {
  readonly written: string;
  readonly bytes: number;
}

/** Build the `{written, bytes}` envelope for a file that was just written. */
export function writePayload(written: string, content: string): CliWritePayload {
  return { written, bytes: Buffer.byteLength(content, 'utf8') };
}

/** The documented `--json` failure envelope. */
export interface CliErrorPayload {
  readonly error: {
    readonly code: string | null;
    readonly message: string;
    readonly details?: unknown;
  };
}

interface ErrorRecord {
  code: string | null;
  message: string;
  details?: unknown;
}

function errorRecord(error: unknown): ErrorRecord {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
    const record: ErrorRecord = {
      code: typeof candidate.code === 'string' ? candidate.code : null,
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
    };
    if (candidate.details !== undefined) record.details = candidate.details;
    return record;
  }
  return { code: null, message: String(error) };
}

export function errorPayload(error: unknown): CliErrorPayload {
  return { error: errorRecord(error) };
}

/** Text-mode failure line, byte-identical to 0.3.0 (`[CODE] message`, debug details appended). */
export function errorText(error: unknown): string {
  const record = errorRecord(error);
  const prefix = record.code === null ? '' : `[${record.code}] `;
  let text = `${prefix}${record.message}\n`;
  if (record.details && process.env.EVOFENCE_DEBUG) text += `${JSON.stringify(record.details, null, 2)}\n`;
  return text;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Render `runEvolution` progress events exactly as 0.3.0 did. */
export function progressReporter(write: Write): (event: unknown) => void {
  return (event) => {
    const record = asObject(event);
    if (record.type === 'run.started') write(`Run ${String(record.run_id)}: base ${String(record.base_sha).slice(0, 12)}, up to ${String(record.iterations)} iteration(s).\n`);
    else if (record.type === 'candidate.proposal.start') write(`Iteration ${String(record.iteration)}: asking ${String(record.adapter)} for a proposal.\n`);
    else if (record.type === 'candidate.implementation.start') write(`Iteration ${String(record.iteration)}: implementing the proposal.\n`);
    else if (record.type === 'candidate.accepted') write(`Iteration ${String(record.iteration)}: ACCEPT ${String(record.generation_id)} (+${String(record.improvement)}).\n`);
    else if (record.check) write(`  Evidence: ${String(record.phase)}/${String(record.check)}\n`);
    else if (record.phase === 'private_regression') write(`  Evidence: private_regression case ${String(record.case)}\n`);
  };
}
