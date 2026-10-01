# L5 legacy 只读边界与升级指南

这是可选 storage 入口 `dist/storage/legacy/index.js`。没有新增 CLI 命令，也没有改旧 CLI、config、ledger 或 core；不从 `storage/index` 或 core 重导出。

## cp1：冻结输入与中性导出

调用者明确指定格式；不通过文件名、cwd、版本范围或缺失字段猜测。

| format | 接受边界 | 拒绝边界 |
| --- | --- | --- |
| `ledger-sqlite-v2` | `events/generations/state` 三表及冻结列；`state.schema_version = "2"` | 无 marker 的 0.3 ledger v1、其他版本、缺表/多表/改列、SQLite 损坏、非空 `-wal`/`-journal` |
| `ledger-bundle-v1` | `schema_version: 1`；完整 events/generations/active_generation/integrity | 未知版本、未知键、payload 与 payload_json 不一致、声明无效的 integrity、断开的 recorded links |
| `contract-yaml-v1` | `contract_version: 1` + 现有 config validator | 未知/缺失版本、未知键、缺少必填项、重复键、无效 YAML |
| `config-yaml-v1` | `version: 1` + 现有 config validator | 同上 |
| `holdout-validator-v2` | 没有 version 字段；明确选定现有 validator v2 的 regressions 文档 | 未知键/缺项/无效值；不会虚构 version |
| `experiment-validator-v2` | 没有 version 字段；明确选定现有 validator v2 的 goal_file 文档 | 同上 |

SQLite 输入是已停止写入并取得完整一致性的临时副本。导出读取其字节，再创建私有临时 snapshot；SQLite 只以 `readonly + fileMustExist` 打开私有 snapshot，绝不打开真实旧 ledger 写入。所有测试仅使用临时生成的 ledger/config 及其副本。

导出固定 namespace `evofence.legacy-export/1`、schemaVersion `1.0.0`，包含 `classification: historical-source`、`executable: false`、真实源 locator、原文件 SHA-256/长度、原始 base64 字节和中性 records。同一输入导出可稳定序列化；没有导出时钟字段。保留 YAML 中省略的字段，两个旧 defaults 不填入归档。

不重算、不修补、不重串旧 chain；原 `payload_json`、`previous_hash`、`event_hash` 保持原值。只检查结构、顺序、记录间已有链接及 bundle 声明的 tip/count。这里的 digest 证明归档与所读原字节一致；不证明旧链的密码学真实性。已有旧版 verifier 仍负责其链验证。

## cp2：显式导入与恢复

`importLegacy(bundle, archiveRoot, importedAt)` 必须由调用者明确发起，`archiveRoot` 是已存在的新目录，`importedAt` 是明确的 UTC epoch 毫秒整数。落盘于 `archiveRoot/legacy-source-v1/<importId>.json`，namespace `evofence.legacy-source/1`、schemaVersion `1.0.0`，与 `evofence.runtime/1@1.1.0`、`evofence.assets/1@1.0.0` 分离。

每条 record 都含 `sourceDigest/sourceFile/sourceFormat/importedAt/importerVersion/classification` 来源标记与 `executable: false`。不进入 asset registry，不产生 ArtifactRef/qualification；不冒充 journal Event、执行 Receipt 或 TaskEvidenceReport。旧 `candidate.accepted` / `generation.accepted` 只是历史文本，不代表新版任务或能力验收。

导入边界从原始 base64 重新解析，核对源 digest、长度、格式和 records，拒绝篡改后的内容。导入保存源字节，原件缺失时仍可离线阅读归档；归档的 locator 是历史出处，导入不会回访或覆盖原件。目标路径按真实目录解析，拒绝来源目录内的 namespace 和 namespace 链接；已存在的归档或硬链接只读，不覆盖。

源身份是 format + 原文件 digest 的 SHA-256；同一完整输入重试返回 `duplicate`，保留第一次导入时间。同字节但不同源 locator 为 `EFK_IDEMPOTENCY_COLLISION`，需保留并审阅冲突，不能覆盖来源。变更后的源字节生成另一份归档，不合并历史链。

先以 `wx` 创建唯一 `.pending`，写入并 fsync 文件，再以原子 hard link 发布最终名字，避免覆盖和半份 JSON。失败/中断只有 `.pending` 而无最终文件时，可重新调用导入；pending 不参与读取，也不自动删除未知遗留文件。最终文件存在时先严格读取校验，然后返回 duplicate；最终文件损坏或版本未知时明确拒绝，保留文件。将原始 bytes 从已有已验证归档另存到新的临时目录，可重新显式导入。

这证明本地重试与已提交文件的恢复；没有承诺断电后目录元数据持久性、外部存储或跨用户恶意竞态安全。`readHistoricalImport` 在每次读取时校验协议、原字节、来源标记和整份历史记录，不能把修改后的 `executable` 默认为 false。

错误均使用现有冻结 ErrorEnvelope：版本 `EFK_PROTOCOL_UNSUPPORTED`；结构/损坏 `EFK_SCHEMA_INVALID`；源/记录摘要不符 `EFK_ARTIFACT_DIGEST_MISMATCH`；改为执行语义 `EFK_LEGACY_NOT_EXECUTABLE`；不完整 snapshot `EFK_SOURCE_PIN_DRIFT`；路径越权 `EFK_AUTHORITY_DENIED`；同身份不同来源 `EFK_IDEMPOTENCY_COLLISION`；I/O 不可用 `EFK_ARTIFACT_UNAVAILABLE`。不增加 wire code 或修改冻结合同。

```js
import { exportLegacy, importLegacy } from './dist/storage/legacy/index.js';

// 这两个目录由调用者预先准备；旧宿主已停止写入，输入仅为一致的临时副本。
const exported = exportLegacy('C:/temp/old-copy/ledger.sqlite', 'ledger-sqlite-v2');
if (!exported.ok) throw new Error(JSON.stringify(exported.error));
const result = importLegacy(exported.value, 'C:/temp/new-archive', 1790899200000);
if (!result.ok) throw new Error(JSON.stringify(result.error));
console.log(result.value.disposition, result.value.file);
```

## cp3：升级选择

**继续使用旧版**：保留原 checkout/配置/ledger/历史图，使用匹配的旧 CLI 和旧链 verifier。旧命令、policy 和 generation refs 的解释仍归旧版；不要让新 runtime 指向旧 ledger。适合需要继续原有审计和旧工作流的用户。

**显式导入**：停止旧宿主写入，取得 ledger 的完整一致临时副本；只复制主 DB 而遗失 WAL 的做法不成立。对副本导出，核对原件与副本 digest，审阅旧数据中的私有内容，在独立目录显式归档并用 `readHistoricalImport` 检查结果。新版任务、grant、budget、host manifest、evaluator 和候选资产需要重新创建；执行/晋升/激活都要求新证据。适合保留历史出处并开始新协议的用户；不存在自动迁移、回写、重放或继承执行资格。

下面覆盖当前 0.4.2 command manifest 的全部 17 个命令、共用 flags、四类 YAML 顶层字段组（包括所有子字段）与 ledger 格式。对应关系是语义升级说明，不宣称新的 CLI 命令已经交付。CLI flags 不转发；旧报表输出和 budget 估计也不提升为新执行证据。

| 旧命令/字段组（breaking key） | 新对应 / 移除 / 拒绝 |
| --- | --- |
| `cli:init` | explicit new TaskContract/session bootstrap; legacy scaffolding stays with the old CLI |
| `cli:run` | KernelService.createSession + handleCommand + dispatchEffect; DSH/Pi execute |
| `cli:proposal inspect` | historical source only; new candidates require fresh bound artifacts |
| `cli:evidence run` | EvaluatorPort.evaluateTask with TaskEvidenceReport; do not replay old shell strings |
| `cli:gate` | four independent DecisionRecord kinds, not a legacy gate result |
| `cli:ledger show` | readHistoricalImport for old records; KernelService.readSession for new state |
| `cli:ledger verify` | old CLI/offline verifier only; this exporter does not recompute chains |
| `cli:ledger recent` | historical source only; new journal views use session identity |
| `cli:ledger export` | exportLegacy for a settled copy; importLegacy is an explicit separate action |
| `cli:diff` | old CLI for old generation refs; new WorkspacePort artifacts pin attempt/base |
| `cli:rollback` | old CLI for old refs; new revocation and scoped activation require receipts |
| `cli:experiment run` | new evaluation protocol and matched-budget experiment; rebuild manually |
| `cli:experiment export` | legacy bundle source only; never an EvaluationReceipt |
| `cli:report` | old text/JSON/SARIF/JUnit remain old views; new session/decision views are separate |
| `cli:budget` | historical estimates only; new BudgetPolicy reserves and settles with complete usage |
| `cli:status` | old state overview; new KernelService.readSession is the journal projection |
| `cli:doctor` | old --fix only with the old CLI; no remediation or discovery in this lane |
| `cli:flags` | no flag forwarding; --json/--format/--bundle/--fix and budget/isolation flags remain old CLI contracts |
| `contract:contract_version` | YAML 1 is not runtime 1; explicitly construct runtime/1 schemaVersion 1.1.0 |
| `contract:objective` | rebuild TaskContract.goal + acceptance; old score is not uplift evidence |
| `contract:hard_invariants` | rebuild acceptance.checkRefs; do not execute imported commands |
| `contract:allowed_evolution_surface` | rebuild Grant.scope and declared workspace resources |
| `contract:protected_paths` | rebuild scoped permissions and WorkspacePort checks |
| `contract:evidence` | rebuild evaluator checks; the two old defaults remain historical values |
| `contract:acceptance` | rebuild acceptance policy; require_proposal/require_claims grant no qualification |
| `contract:capabilities` | rebuild grants/guarantee requirements; validated authority_ceiling and request-path flags do not prove isolation |
| `contract:budgets` | rebuild shared BudgetPolicy/reservations; iterations and estimates are not new usage receipts |
| `config:version` | YAML 1 stays historical; no default or automatic runtime conversion |
| `config:adapters` | explicit injected HostPort + exact HostManifest; command/model/agent strings do not select or launch a host |
| `holdout:regressions` | historical private source; rebuild evaluator-only checks without revealing oracle feedback |
| `experiment:goal_file` | read source manually and author a new TaskContract |
| `experiment:adapter` | explicit HostPort/HostManifest; no automatic command discovery |
| `experiment:iterations` | new termination.maxAttempts and bounded graph loops |
| `experiment:max_wall_clock_ms` | new budget/termination wall bound; human wait accounted separately |
| `experiment:allow_unisolated_agent` | new Scope.trustDomain and negotiated guarantees; flag grants no sandbox |
| `experiment:allow_readable_holdout` | new evaluator-only privacy policy; old flag grants no new authority |
| `ledger:schema_version` | SQLite marker 2/bundle marker 1 are legacy only; unmarked v1/unknown versions refused |
| `ledger:events` | historical records only; no Event/Receipt/TaskEvidenceReport creation |
| `ledger:generations` | historical Git references only; not AssetRef or activation qualification |
| `ledger:state` | historical schema_version/active_generation; never a runtime projection |
| `ledger:chain` | copy payload_json/previous_hash/event_hash byte-for-byte; never migrate or recompute |
| `ledger:integrity` | copy declared bundle integrity; structural checks do not prove cryptographic authenticity |

旧 contract 的 `acceptance.require_proposal/require_claims` 是兼容字段；`capabilities.authority_ceiling` 仅校验，network/dependency_install/credentials/external_api 按旧请求路径判断且未声明实际使用没有检测信号；`capabilities.shell.mode` 为已移除的 template key，不是 runtime gate。新 grant/host 保证必须重新协商，不能由这些旧值证明隔离或权限。

未证明：完整旧 GUI/外部 exporter 覆盖，未标记 v1 的兼容读取、旧链密码学认证、旧 task 的自动转换、磁盘断电和远程文件系统持久性、真实新宿主激活，以及跨用户恶意竞态的隔离。L5 证据是临时磁盘/夹具和真实 negative control，不是 provider-live 或能力收益测量。

## lane 证据

测试位于 `test/l5-legacy-*.test.js`，只从本次 build 的 `dist/**` 导入。负控在子进程通过 loader 对真实构建模块做单点变异；未知版本被接受、回写临时源、历史标为 executable、breaking 清单缺项各执行 green → red → restored green。文件与 core 不被变异写回。

门禁与原件 digest、负控退出码记录于同目录 `evidence/`；详见 `REPORT.md`。不 commit、不 install、不操作 `.graph`，由 orchestrator 记录节点状态。
