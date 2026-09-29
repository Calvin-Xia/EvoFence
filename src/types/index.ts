/**
 * `src/types` — the shared type contract layer for the L2 domain refactor.
 *
 * This is the ONLY entry point other domains should import from:
 *
 *     import type { EvoFenceContract, GateDecisionPayload } from '../types/index.js';
 *
 * Submodule map (import the narrow module when you only need one domain):
 *   - `shared.js`   — cross-cutting primitives + `AdapterName` / `RunOutcomeStatus`.
 *   - `config.js`   — `.evofence/*.yaml` shapes + the v2 config-validation envelope.
 *   - `ledger.js`   — event rows, hash chain, generations, read views.
 *   - `proposal.js` — the agent's `proposal.json` / `claims.json` and the checks on them.
 *   - `evidence.js` — the evidence gate's per-command results, bundles and objective delta.
 *   - `gate.js`     — the four gates' inputs, risk assessment, and verdicts.
 *   - `exec.js`     — process/adapter results, usage accounting, worktree metadata.
 *   - `report.js`   — `report` / `status` / `diff` JSON views.
 *
 * DEPENDENCY RULE: `src/types/**` may import NOTHING except other `src/types/**` modules,
 * and only in one direction (see `README.md`). There are no runtime dependencies
 * (`better-sqlite3`, `yaml`) and no imports from `src/lib/**`, so this layer can never
 * participate in a runtime cycle. `npm run dep:check` enforces acyclicity.
 *
 * Everything here is DERIVED from the 0.3.0 implementation (see each module's header for the
 * exact source files and `docs/refactor-inventory.md` sections). Do not design new shapes
 * here: add a type only when it is genuinely shared by two or more domains.
 */

export {
  ADAPTER_NAMES,
  RUN_OUTCOME_STATUSES,
  ZERO_HASH,
} from './shared.js';
export type {
  AdapterName,
  EvoFenceErrorCode,
  Hash256Hex,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ProcessSignal,
  RepoRelativePath,
  RunOutcomeStatus,
  RunSummaryStatus,
  UsdMicros,
} from './shared.js';

export { LEDGER_EVENT_TYPES, ACTIVE_GENERATION_STATE_KEY } from './ledger.js';
export type {
  ArtifactPath,
  EventHashInput,
  GenerationRecord,
  LedgerChainInvalid,
  LedgerChainValid,
  LedgerEvent,
  LedgerEventRecord,
  LedgerEventType,
  LedgerExport,
  LedgerSnapshot,
  LedgerStateRow,
  LedgerTableName,
  LedgerVerification,
  RecentRunSummary,
} from './ledger.js';

export type {
  AcceptanceConfig,
  AdapterConfig,
  AuthorityCeiling,
  BudgetsConfig,
  CapabilitiesConfig,
  CapabilitySetting,
  ConfigDocumentKind,
  ConfigIssueCode,
  ConfigValidationIssue,
  ConfigValidationReport,
  ConfigValidationResult,
  EvoFenceConfig,
  EvoFenceContract,
  EvidenceCommandConfig,
  ExperimentManifest,
  HardInvariantConfig,
  ObjectiveConfig,
  ObjectiveDirection,
  PrivateRegressionConfig,
} from './config.js';

export { PI_TOOL_STRATEGY_VERSION, TASK_FILE_NAME } from './exec.js';
export type {
  AdapterEventPayload,
  AdapterPhase,
  AdapterRunResult,
  AdapterUsage,
  AdapterUsageSnapshot,
  BudgetEventPayload,
  BudgetObservation,
  ChangedPath,
  EvidencePhase,
  PiToolStrategySummary,
  PiToolStrategyToolSummary,
  ProcessResult,
  RunEvolutionOptions,
  RunIterationOutcome,
  RunOutcome,
  RunOutcomeFailure,
  StopReason,
  TimedProcessResult,
  TrustedCommandResult,
  WorktreeMetadataSnapshot,
} from './exec.js';

export {
  BUILTIN_GRANTED_CAPABILITIES,
  GATE_DECISIONS,
  KNOWN_CAPABILITY_KEYS,
  RISK_BANDS,
} from './gate.js';
export type {
  BudgetGateInput,
  BudgetGateResult,
  BudgetMetric,
  CapabilityReview,
  CapabilityReviewEntry,
  ContractGateInput,
  ContractGateResult,
  GateAuditView,
  GateDecision,
  GateDecisionEvent,
  GateDecisionPayload,
  GateReason,
  GateVerdict,
  IsolationGateInput,
  IsolationGateResult,
  PathViolation,
  PolicyDocument,
  PolicyHashes,
  RiskAssessment,
  RiskBand,
} from './gate.js';

export type {
  CandidateCheckAccepted,
  CandidateCheckCode,
  CandidateCheckRefused,
  CandidateCheckResult,
  CapabilityRequest,
  Claims,
  Proposal,
} from './proposal.js';

export type {
  EvidenceBundle,
  EvidenceCaseSummary,
  EvidenceCheckSummary,
  EvidenceGateInput,
  EvidenceGateResult,
  ObjectiveComparison,
  ObjectiveEvidence,
  PrivateEvidenceCase,
  PrivateEvidenceSummary,
} from './evidence.js';

export type {
  AuditEvidence,
  AuditEvidenceCheck,
  AuditObjective,
  EvolutionReport,
  BudgetForecastMetric,
  BudgetForecastRun,
  BudgetForecastView,
  GenerationDiff,
  ReportBudgets,
  ReportGenerationSummary,
  ReportIntegrity,
  ReportObjective,
  ReportObjectiveGroup,
  ReportRunSummary,
  StatusIntegrity,
  StatusTotals,
  StatusView,
} from './report.js';
