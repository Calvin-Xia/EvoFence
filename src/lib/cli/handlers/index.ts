/**
 * The handler registry: `CommandSpec.name` -> implementation.
 *
 * DOMAIN: CLI (node `l2_cli`). Pure data — the entry resolves a route, asks for the handler by
 * canonical name and calls it. A command with no handler, or a handler with no command, is a
 * manifest/registry drift bug; `test/cli-surface.test.js` asserts the two sets are identical.
 */
import type { CommandHandler } from './context.js';
import { commandInit } from './init.js';
import { commandRun } from './run.js';
import { commandEvidenceRun, commandGate, commandProposalInspect } from './queries.js';
import { commandLedgerExport, commandLedgerRecent, commandLedgerShow, commandLedgerVerify } from './ledger.js';
import { commandDiff } from './diff.js';
import { commandRollback } from './rollback.js';
import { commandExperimentExport, commandExperimentRun } from './experiment.js';
import { commandReport } from './report.js';
import { commandStatus } from './status.js';
import { commandDoctor } from './doctor.js';

export type { CommandContext, CommandHandler } from './context.js';

export const HANDLERS: Readonly<Record<string, CommandHandler>> = {
  init: commandInit,
  run: commandRun,
  'proposal inspect': commandProposalInspect,
  'evidence run': commandEvidenceRun,
  gate: commandGate,
  'ledger show': commandLedgerShow,
  'ledger verify': commandLedgerVerify,
  'ledger recent': commandLedgerRecent,
  'ledger export': commandLedgerExport,
  diff: commandDiff,
  rollback: commandRollback,
  'experiment run': commandExperimentRun,
  'experiment export': commandExperimentExport,
  report: commandReport,
  status: commandStatus,
  doctor: commandDoctor,
};
