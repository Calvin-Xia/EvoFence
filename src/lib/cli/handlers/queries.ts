/**
 * Read-side query commands: `proposal inspect`, `evidence run`, `gate`.
 *
 * DOMAIN: CLI handler (node `l2_cli`). All three always emit JSON (0.3.0) and now also accept an
 * explicit `--json` (ADR-0003). No domain decision is made here: the events are read from the
 * ledger and printed, and `collectEvidence` is called for the evidence re-run.
 */
import path from 'node:path';
import { loadContract, loadPrivateHoldout } from '../../contract.js';
import { collectEvidence } from '../../evidence.js';
import { EvoFenceError } from '../../errors.js';
import { repositoryRoot } from '../../git.js';
import { Ledger, ledgerPath } from '../../ledger.js';
import { jsonDocument, progressReporter } from '../output.js';
import { payloadObject } from '../../report/ledger-view.js';
import type { EvidencePhase } from '../../../types/index.js';
import { positional, type CommandContext } from './context.js';

/** Print the `proposal.created` payload for a proposal id. */
export async function commandProposalInspect(context: CommandContext): Promise<number> {
  const proposalId = positional(context, 0);
  const root = await repositoryRoot(context.cwd);
  const ledger = new Ledger(ledgerPath(root));
  try {
    const event = ledger.events().find((item) => (
      item.event_type === 'proposal.created' && payloadObject(item.payload)?.proposal_id === proposalId
    ));
    if (!event) throw new EvoFenceError('PROPOSAL_NOT_FOUND', `Proposal not found: ${proposalId}`);
    context.stdout(jsonDocument(payloadObject(event.payload)?.proposal));
    return 0;
  } finally {
    ledger.close();
  }
}

/** Re-run the contract's evidence commands against a candidate directory. */
export async function commandEvidenceRun(context: CommandContext): Promise<number> {
  const root = await repositoryRoot(context.cwd);
  const candidate = path.resolve(context.cwd, positional(context, 0) as string);
  const contract = await loadContract(root);
  if (!contract.hard_invariants.length && !contract.evidence.public_commands.length) {
    throw new EvoFenceError('NO_EVIDENCE_CONFIGURED', 'Add at least one hard invariant or public evidence command to .evofence/contract.yaml before running evidence.');
  }
  const holdout = await loadPrivateHoldout(root);
  const evidence = await collectEvidence({
    root: candidate,
    artifactRoot: path.join(root, '.evofence'),
    contract,
    holdout,
    runId: `manual-${Date.now()}`,
    iteration: 0,
    phase: 'manual' as EvidencePhase,
    onProgress: context.json ? undefined : progressReporter(context.stdout),
  });
  context.stdout(jsonDocument(evidence));
  return evidence.all_public_passed && evidence.all_private_within_tolerance ? 0 : 1;
}

/** Print the last `gate.decision` recorded for a proposal id. */
export async function commandGate(context: CommandContext): Promise<number> {
  const proposalId = positional(context, 0);
  const root = await repositoryRoot(context.cwd);
  const ledger = new Ledger(ledgerPath(root));
  try {
    const events = ledger.events();
    const proposal = events.find((item) => (
      item.event_type === 'proposal.created' && payloadObject(item.payload)?.proposal_id === proposalId
    ));
    if (!proposal) throw new EvoFenceError('PROPOSAL_NOT_FOUND', `Proposal not found: ${proposalId}`);
    const decisions = events.filter((item) => (
      item.event_type === 'gate.decision'
      && item.run_id === proposal.run_id
      && payloadObject(item.payload)?.iteration === payloadObject(proposal.payload)?.iteration
    ));
    const last = decisions.at(-1);
    if (!last) throw new EvoFenceError('GATE_DECISION_NOT_FOUND', `No Gate decision recorded for ${proposalId}.`);
    context.stdout(jsonDocument({ proposal_id: proposalId, ...payloadObject(last.payload) }));
    return 0;
  } finally {
    ledger.close();
  }
}
