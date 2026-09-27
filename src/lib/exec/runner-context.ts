/**
 * Exec domain · the mutable run context shared by the runner submodules.
 *
 * `runEvolution`'s 0.3.0 body mutated eleven closure variables across ~490 lines. Splitting it
 * into phases would have silently changed behavior unless that state had one explicit home, so
 * every mutable counter/field moved into {@link RunState} and every immutable input into
 * {@link RunContext}. Field names and update points are unchanged from the original closure.
 */
import type { Ledger } from '../ledger.js';
import type {
  AdapterName,
  Claims,
  EvoFenceConfig,
  EvoFenceContract,
  GenerationRecord,
  JsonValue,
  PolicyHashes,
  Proposal,
  RunOutcome,
} from '../../types/index.js';
import type { AdapterRunner } from './runner-adapter.js';

/** Mutable per-run counters and handles. */
export interface RunState {
  failureCount: number;
  noImprovementCount: number;
  /** Commit the next candidate is built from. */
  activeSha: string;
  /** Active generation row, or `null` before the baseline generation exists. */
  activeGeneration: GenerationRecord | null;
  /** Objective score of the last accepted generation; `null` until the baseline ran. */
  baselineScore: number | null;
  observedTokens: number;
  observedCostMicros: number;
  costTotalUnknown: boolean;
  /** Worktree currently in flight, or `null` between candidates. */
  worktree: string | null;
}

/** Immutable inputs plus the mutable state for one `runEvolution` call. */
export interface RunContext {
  root: string;
  goal: string;
  adapter: AdapterName;
  contract: EvoFenceContract;
  config: EvoFenceConfig;
  holdout: unknown[];
  limitIterations: number;
  wallClockLimit: number;
  deadlineAt: number;
  initialHashes: PolicyHashes;
  runId: string;
  ledger: Ledger;
  tempParent: string;
  runTempRoot: string;
  runStartedAt: number;
  tokenLimit: number | null;
  costLimitMicros: number | null;
  adapterRunner: AdapterRunner | null;
  allowUnisolatedAgent: boolean;
  onProgress: (event: JsonValue) => void;
  outcome: RunOutcome;
  state: RunState;
}

/** The proposal/implementation stage result handed to the evaluation phase. */
export interface CandidateStage {
  iteration: number;
  parentSha: string;
  iterationId: string;
  proposal: Proposal;
  proposalDigest: string;
  claims: Claims;
}
