# l5_legacy_boundary 独立交叉复核（review-1）

日期 / 复核者（pane）：
- 日期：2026-10-02
- 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**；全程只读，唯一写入是本 dossier）

复核对象（commit + 文件/行数 + 用例数）：
- 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，复核提交 **`c89e62d1d80de4120ea400fd5c07c6cc2a3bd3fc`**（父 `bb8b71d`；任务基线 `d2e311df7b7fbf18c28c7c849126d3be3bd6f1cb` 为其祖先，`git merge-base --is-ancestor d2e311d c89e62d` = true）。
- `src/storage/legacy/**`：9 个 TS 模块 / **459** 行（`types 53`、`formats 30`、`boundary 77`、`exporter 49`、`importer 88`、`ledger 70`、`sqlite 40`、`breaking 45`、`index 7`）+ 文档（`README 112`、`REPORT 49`）+ `evidence/**` 原始日志 17 个（`summary.json`、`negative-controls.json`、`scope.json`、`static-audit.json`、两份 test-run stdout，其余 stdout/stderr 全为 0 字节）。
- `test/l5-legacy-*.test.js`：4 文件 / **400** 行 / `node --test` 报 **23**（= 19 条命名行为用例 + 4 条真实变异负控用例）。
- lane 作者工作区（**仅 sha256 比对，未写**）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l5-legacy`，branch `refactor/hk-l5-legacy`，HEAD 仍是 `d2e311d`，产物全部 untracked、tracked diff 为空。
- `git show --name-status c89e62d` = **32 A**（本节点只增不改：`src/storage/legacy/**` 28 + `test/l5-legacy-*.test.js` 4；`src/{protocol,kernel,runtime,learning,lib}/**` 与既有模块零改动）。
- 管辖 ADR：`adr_0004`（事件真相源 / 新 journal，native SQLite 可选独立导入）、`adr_0010`（全面 breaking、旧数据只读导出 + 显式导入为历史来源，不原地覆盖/重写 chain）。

## 结论：**可接受**（blocker 0 / major 0 / minor 1 / nit 2）

复核简报 §1 列的 8 条断言**逐条独立取证通过**：六种旧格式**显式选定**、未知/损坏/未标记版本一律 typed 拒绝（`EFK_PROTOCOL_UNSUPPORTED` / `EFK_SCHEMA_INVALID`），原文摘要前后 hex 相等、导出不改原件、不重算旧链（`payload_json`/`previous_hash`/`event_hash` 逐字节保留）；导入落新 namespace `evofence.legacy-source/1@1.0.0`（与 `evofence.runtime/1@1.1.0`、`evofence.assets/1@1.0.0` 分离），逐条 `sourceDigest/sourceFile/sourceFormat/importedAt/importerVersion/classification + executable:false`，`wx` + fsync + 原子 hard link 发布，重启/中断恢复、幂等 duplicate、同身份异源 `EFK_IDEMPOTENCY_COLLISION` 全部可复现，**不原地 migrate/不合并旧 chain**；旧历史被**全部** 5 类新证据 kind（Event/Receipt/TaskEvidenceReport/CapabilityAsset/ArtifactRef）与 `EventStore.createSession`/`stageRevision` 拒绝，不冒充新 journal、不进 asset 晋升路径；`BREAKING_CHANGES` 42 行 = 17 命令 + flags + 四类 YAML 18 个顶层字段组 + 6 个 ledger 边界，与 `docs/config.md`/`CHANGELOG.md` 抽样一致，且被机器用例钉死；真实旧 ledger/config（`EvoFence-wt/archive/f{1,2,3}-evofence/**`）mtime 仍为 2026-09-26 17:53，**未被触碰**；四门禁 0、`node --test test/l5-legacy-*.test.js` **两次 23/23**、`static-audit` exit 0 / `violations: []`。我方自建探针 + 3 组独立 loader 变异负控 0→1→0 复现，证据文件与实际结果逐项一致。1 个 minor 是**证据口径**说明（非缺陷），2 个 nit 是设计边界附注。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 1 | **m1（证据口径）**：`evidence/summary.json`/`REPORT.md` 记录的是 **lane 基线** `d2e311d` 的数字（`src:policy` 240 TS、`dep:check` 240 模块/927 边），而集成 HEAD（含其后并入的 L4 `src/learning/retrieval/**` 5 个模块）实测为 **245 TS / 948 边**。差异完全由 lane 基线早于 L4 合入解释（`git show --name-status c89e62d` 证明本节点自身只新增 lane 文件）；`static-audit` 两处均为 **88 模块 / 358 边 / 0 violations**（该 audit 只覆盖 `src/{protocol,kernel,runtime}`，故一致）。证据未声称是集成口径，我方在集成环境重跑全部门禁得同一结论。 |
| nit | 2 | **n1（文案口径）**：`README.md` 结尾称对照表“四类 YAML 顶层字段组（包括所有子字段）”，但 `BREAKING_CHANGES` 实际是**顶层字段组**粒度（`contract:objective`、`budgets`、`config:adapters` 等），嵌套子字段（如 `objective.direction`、`budgets.max_iterations`、`adapters.<host>.model`）只在替换文案里以散文提及、未逐条枚举。字段组覆盖完整且被 `l5-legacy-checklist` 用例机器钉死，此措辞略宽于粒度，非缺陷。**n2（TOCTOU 边界）**：`boundary.ts readRegular` 先 `lstatSync(file)` 判非符号链接、再 `readFileSync(file)`，两次调用之间存在同用户符号链接替换窗口；导出后用 `realpath` 目标重读一次并比对 digest（`EFK_SOURCE_PIN_DRIFT`）可界定“读中改”，但不消除该竞态。README 已如实声明不承诺跨用户恶意竞态安全，与设计一致。 |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：`src/storage/legacy/**` 9 TS + 2 文档 + 4 test 文件在 lane ⇔ 集成工作区逐文件比对，**15/15 全等**；lane `git status` 显示产物全部 untracked、HEAD 未动（tracked diff 为空）。
2. **门禁实测**（集成副本；ADR-0004：测试只吃本次 build 的 `dist/`）：
   - `npm run build` → exit 0；`npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0：`245 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s)`
   - `npm run dep:check` → exit 0：`modules 245 / edges 948 / cycles 0 / acyclic: true`
   - `node --test test/l5-legacy-*.test.js` 连跑两次 → 各 `tests 23 / pass 23 / fail 0 / skipped 0 / cancelled 0`，两次 TAP 用例名逐行相同
   - `node verification/kernel/static-audit.mjs` → exit 0，`status: "passed"`，`moduleCount 88`，`edgeCount 358`，`"violations": []`
3. **独立探针 3 组**（自建脚本置于 cwd 下临时目录、只 import 集成副本 `dist/**`，fixture 用 `Ledger` + `mkdtemp` 自造，不复用作者 fixture；见 §3）。
4. **独立变异负控 3 组**（自建 loader 只改**内存中**本次 build 的 `dist/storage/legacy/*.js`，跑 green→red→restored，从不写 dist；见 §2）。
5. **全量源码通读**：9 个 TS 模块 + `README.md` + `REPORT.md` + 4 个 test 文件全文；`exporter.ts`/`importer.ts`/`ledger.ts`/`sqlite.ts`/`boundary.ts` 的拒绝路径逐行核对。
6. **交叉核对**：`evidence/*` 与 `REPORT.md` 逐项对齐；`scope.json` 13 个文件 digest 与当前 sha256 逐字节相等；`negative-controls.json` 4 条与我方实跑诊断逐字段相等；`grep` 核对依赖方向（legacy 不被 runtime 引用、不被 `storage/index`/core 重导出）。

---

## 1. 必须核验的断言逐条判定

| # | 断言 | 判定 | 实测证据 |
|---|---|---|---|
| 1 | 只读导出：不改原文件、不重算旧 hash 链；原件 digest 前后一致 | ✅ | 源码：`exporter.ts exportLegacy` 只 `readRegular`（`lstat` 判普通文件、拒符号链接）读字节，`recordsFrom` 纯解析；`ledger.ts` 只做 `seq===index+1`、`recordedPrevious===previous`、`event_hash` 去重与 `json(payload_json)`，`hash()` 只校验 64 位 hex、**从不计算/替换 event_hash**；`sqlite.ts sqliteRecords` 把字节写到 `os.tmpdir()` 私有 snapshot，只以 `readonly + fileMustExist` 打开，绝不打开真实 ledger。探针 **P1**：`exportLegacy` 前后原件与副本 hex 完全相等，`records.event_hash === ledger.export().events[].event_hash` 逐条相等，`copies/` 目录仅原文件（无 sidecar），同输入两次导出 `canonical` 相同。作者用例 `DoD1 originals and copied sources keep exact digests across export and import`、`cp1 SQLite and bundle exports are stable and preserve raw payloads and recorded hashes`。独立负控 **NC-2**（导出后实际回写副本）green→red→restored 复现 |
| 2 | 版本探测：未知/损坏旧格式**明确拒绝**（typed），不猜测、不降级 | ✅ | 源码：`requireFormat` 白名单拒 `EFK_PROTOCOL_UNSUPPORTED`；YAML 走 pin 死 validator + `version/contract_version===1` 断言，重复键/别名/非 JSON/非法 UTF-8 拒 `EFK_SCHEMA_INVALID`；SQLite 要求三表冻结列 + `state.schema_version='2'`（无 marker 的 v1 明确拒） + `integrity_check`；bundle 要求 `schema_version===1` + integrity/tip 自洽。探针 **P2**：`version:2`/缺 version/`nightly` → `EFK_PROTOCOL_UNSUPPORTED`；`typo`/重复键/坏 YAML → `EFK_SCHEMA_INVALID`；未知 format → `EFK_PROTOCOL_UNSUPPORTED`；每次拒绝前后原文件 hex 不变。作者用例 `DoD1 unknown SQLite version is explicitly refused with no source writes`、`cp1 unmarked v1, foreign tables, extra columns and unreadable SQLite are refused`、`cp1 unknown YAML/bundle versions, unknown keys, duplicates and malformed input reject`、`cp1 non-JSON YAML, cyclic aliases and invalid UTF-8 refuse without source mutation`。独立负控 **NC-1**（删除版本拒绝）green→red→restored 复现 |
| 3 | 新 namespace 导入：来源标记逐条可核；幂等或 typed 冲突；不原地 migrate/合并旧 chain | ✅ | 源码：`importer.ts` 归档到 `archiveRoot/legacy-source-v1/<importId>.json`，namespace `evofence.legacy-source/1`（`importId = digest(format+'\n'+sourceDigest)`，纯 hex 无路径注入）；`historical()` 给每条 record 打 `provenance{sourceDigest,sourceFile,sourceFormat,importedAt,importerVersion,classification}` 且 `executable:false`；`destination()` 用 realpath 解析、拒 namespace 被 source 目录包含/反向包含、拒 symlink 目录；发布用 `wx` pending + `fsync` + `linkSync` 原子无覆盖；`decodeImport` 从原始 base64 重解析后与重建值 `canonical` 全等比对，任何篡改拒 `EFK_LEGACY_NOT_EXECUTABLE`。探针 **P1/P3**：首次 `imported`→重试 `duplicate`（保留首次 `importedAt`）、归档 `readHistoricalImport` 往返全等、删源后离线可读、伪造 importerVersion/可执行位/namespace 全部 typed 拒绝。作者用例 `cp2 import is idempotent with per-record source digest, time and importer version`、`cp2 all six formats import independently and remain readable without the old source`、`cp2 immutable conflicts and damaged archive retry fail without replacement`、`cp2 restart reuses a committed archive and ignores interrupted pending files`、`cp2 actual process termination before publication recovers through explicit retry`（真实子进程在 fsync 后、link 前 `process.exit(73)`，仅留 `.pending`） |
| 4 | 旧历史不作新版执行证据：不进 asset 晋升路径、不冒充新 journal 事件 | ✅ | 依赖方向：`grep -rn "storage/legacy" src/` 在 `src/storage/legacy/` 之外 **零命中**；`src/storage/index.ts`、`src/kernel/store/index.ts` 均未重导出 legacy。探针 **P3**：旧 ledger 的 `candidate.accepted` 事件被 5 类协议 kind（record 与 `.value` 两形态）全部拒绝，`createSession` 得 `EFK_PROTOCOL_UNSUPPORTED`（namespace 不匹配）、`sessionIds()=[]`，`stageRevision` 拒、registry 仍 `emptyRegistry()`。作者用例 `DoD2 old accepted ledger remains historical and cannot enter journal or asset qualification`。独立负控 **NC-3**（把 record 标成 executable）green→red→restored 复现 |
| 5 | DoD② breaking 对照：覆盖旧命令/字段（对照 CHANGELOG/config.md 抽样）；升级指南可执行 | ✅ | `BREAKING_CHANGES` **42 行不重复** = 17 命令 + `cli:flags` + contract 9 + config 2 + holdout 1 + experiment 6 + ledger 6，与 `Object.keys(documentSchema(kind).fields)` 逐组相等（探针 **P3**：`COMMANDS.length=17`、`missingCmd=[]`、`missingFieldGroups=[]`）。抽样对照 `docs/config.md`：两个旧默认 `per_command_timeout_ms=120000`/`max_output_bytes=1048576`、`acceptance.require_proposal/require_claims` 兼容-only、`capabilities.authority_ceiling` validated-only、`external_api` live gate —— 与 README 末段一致；`capabilities.shell.mode` 为已移除 template key 与 `CHANGELOG.md` 0.4.2 项一致。升级指南给出“继续旧版 vs 显式导入”两条路径与可运行 `import` 示例。作者用例 `DoD2 breaking checklist covers every legacy command and every config group`、`cp3 README contains every breaking mapping, both upgrade choices and explicit recovery boundaries` |
| 6 | 真实旧 ledger/config **未被触碰**（lane 只用临时副本） | ✅ | 集成/lane 工作区均无 `.evofence` 目录；真实旧件在 `EvoFence-wt/archive/f{1,2,3}-evofence/`：`ledger.sqlite`(±wal/shm)、`config.yaml`、`contract.yaml`、`private/holdout.yaml` 的 mtime 全为 **2026-09-26 17:53**（早于本节点 10-02 06:0x 开工），`find archive -printf` 最新 mtime 亦为该时刻 → 未被写。`grep -E '[A-Za-z]:\\\\[^"]*(Temp\|AppData\|Users)[^"]*'` 在 `evidence/*.json` **零命中**；测试 fixture 全走 `mkdtempSync(os.tmpdir())`。作者用例 `DoD1 originals and copied sources keep exact digests across export and import`、`cp3 source directory, namespace links and source hardlinks never become write targets` |
| 7 | 门禁与边界 | ✅ | build/typecheck/src:policy/dep:check 全 exit 0（数字见 §0.2）；两次 23/23；`static-audit` exit 0 / 0 violations；`git show --name-status c89e62d` = 32 A（0 M/D），`bb8b71d..c89e62d` 亦为纯新增 8789 行，core 与既有语义零改动 |
| 8 | 证据与负控：`evidence/*` 与实况一致；抽查 1–2 负控 0→1→0；未证明项如实 | ✅ | `scope.json` 13 文件 digest 与当前 sha256 **13/13 相等**；`negative-controls.json` 4 条与我方实跑诊断**逐字段相等**（`green=[0,1,0] red=[1,0,1] restored=[0,1,0] distUnchanged=true`）；全部 `.stderr.txt` 0 字节；`static-audit.json` `violations:[]`。我方**另做 3 组独立变异**（自建 loader）0→1→0（见 §2）。未证明项：`summary.json.limitations` 与 `README` 末段一致列出「未标记 v1 兼容读取、旧链密码学认证、旧 GUI/外部 importer 覆盖、断电/远程 FS 持久性、跨用户恶意竞态隔离、真实新宿主激活/能力收益」——与代码与 README 的明示声明一致。**独立负控 NC-4**（删 breaking `cli:doctor`）亦随作者套件 0→1→0 |

---

## 2. 独立变异负控（自建 loader，只变内存模块，dist 零写入）

| # | 断言 | 变异点（`dist/storage/legacy/*.js`） | green (exit/pass/fail) | red | restored |
|---|---|---|---|---|---|
| NC-1 | DoD① 未知版本拒绝 | `sqlite.js` `if (version?.value !== '2')` → `if (false)` | 0 / 1 / 0 | **1 / 0 / 1**（`unknown SQLite version was accepted`，AssertionError） | 0 / 1 / 0 |
| NC-2 | DoD① 只读导出不改原件 | `exporter.js` 导出返回值前插入 `writeFileSync(source.file, bytes+'mutant-write')` | 0 / 1 / 0 | **1 / 0 / 1**（`digest changed`） | 0 / 1 / 0 |
| NC-3 | DoD② 旧历史不作执行证据 | `importer.js` `executable: false` → `true` | 0 / 1 / 0 | **1 / 0 / 1**（`old history was marked as execution evidence`） | 0 / 1 / 0 |

- NC-4 由作者套件自带（`breaking.js` 删 `cli:doctor` 项）：实跑 `real negative control breaking-command-omitted` green/red/restored = `[0,1,0]/[1,0,1]/[0,1,0]`，red 输出 `missing breaking command: doctor`（AssertionError）。
- 4 组负控的 green/red/restored 与 `evidence/negative-controls.json` **逐条一致**；所有变异经 `--experimental-loader` 只替换内存 source，`dist/**` sha256 前后不变（`distUnchanged:true`），且我方从未对 dist 落盘变异。

## 3. 独立探针明细（自建 `dist/**` 消费者）

- **P1 只读导出 + 导入幂等 + 离线**：`Ledger` 造 2 事件 + 1 generation → 复制为 `copies/ledger.sqlite` → 原件/副本 hex 前后相等、`event_hash` 逐条保留、`copies/` 无 sidecar、两次导出 canonical 相同；`importLegacy` 首 `imported`/重试 `duplicate`（保留首时间 100）、归档往返全等、provenance 六字段齐全、全 `executable:false`；删源后仍可读，归档目录只有一个 `<importId>.json`。
- **P2 版本/损坏拒绝（含源不变）**：5 组畸形 YAML + 未知 format 的 code 逐条符合预期，且每次拒绝前后源文件 hex 不变；导入侧伪造 namespace→`EFK_PROTOCOL_UNSUPPORTED`、`executable:true`→`EFK_LEGACY_NOT_EXECUTABLE`、篡改 base64→`EFK_ARTIFACT_DIGEST_MISMATCH`、伪造 importerVersion→读到即 `EFK_LEGACY_NOT_EXECUTABLE`。
- **P3 breaking 覆盖 + 证据方向**：`COMMANDS=17`、missing command/field 组均为空、`BREAKING_CHANGES` 42 行唯一；旧事件被 5 类协议 kind 全拒、`createSession`/`stageRevision` 拒且 `eventstore.sessionIds()=[]`、`artifacts.ids()=[]`、registry 仍为空。

## 4. 证据核对

- `scope.json`：13 个产物 digest 与集成文件 sha256 **全等**；`trackedDiffAgainstBaseline: []`、`allowedUntrackedOnly: true`、note「Real ledger/config state was never read or written; native fixtures use temporary paths only」与实测一致。
- `summary.json`：`cp1/2/3=passed`、四门禁 exit 0、两次 23/23、`repeatability{countsEqual,namesEqual,controlsEqual}=true`。其中 `src:policy 240 TS / dep:check 240,927` 是 lane 口径（见 m1）；我方集成实测 245/948，仍全 0。
- `negative-controls.json` / 两份 `test-run-*.stdout.txt` / 全部 `.stderr.txt`：与实跑一致（见 §1-8、§2）。
- `REPORT.md`：cp1/2/3 陈述与源码/探针一致；“最大 lane 文件 179 行”取自 `split('\n')` 计数（`wc -l`=178），紧贴事实、不影响 350 行门禁。

## 5. 发现

- **m1（证据口径，非缺陷）**：见上表 minor。建议后续把 `summary.json` 的门禁条目标注为“lane 基线口径”，避免与集成 HEAD 数字混淆。
- **n1（文案口径）**：`README.md` “（包括所有子字段）”建议改为“顶层字段组（子字段见替换说明）”，与 `BREAKING_CHANGES` 粒度对齐。
- **n2（TOCTOU 边界）**：`readRegular` lstat→read 之间存在同用户符号链接替换窗口；已由“导出后 realpath 重读比对 digest”界定读中改，README 明示不承诺恶意竞态，非阻塞。

## 6. 未证明项（复核确认如实）

- 未标记 v1 旧 ledger 的兼容读取（明确拒绝，不提供）；旧链**密码学真实性**未独立认证（仅保留 recorded hash、结构连续性）；
- 旧 GUI / 外部 exporter / importer 的完整覆盖未证明；
- 断电后目录元数据持久性、远程文件系统持久性未证明（仅 fsync 文件 + 原子 link）；
- 跨用户恶意竞态隔离、真实新宿主激活与能力收益未测量。
- 这些均与 `README` 末段、`summary.json.limitations` 一致，无夸大。
