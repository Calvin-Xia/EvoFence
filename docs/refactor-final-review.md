# EvoFence 0.4.0 重构 · 独立交叉复核报告

- 复核节点：`l5_review`（claim_by `herdr-review2`，本会话 pane `wA:pK`）
- 复核人资格：本会话未参与本图任何节点的执行（`herdr-review2` 与其余 13 个 `claim_by` 无交集）
- 复核对象：`.graph/evofence-ts-refactor` 全图 17 个 `passed` 节点 + 主检出 `e3f42c3`
- 复核日期：2026-09-27；所有结论均由复核人重新执行命令得出，不采信任何 execution_report 自述
- 写入范围：仅本文件。其余源码/测试/文档/配置/`.graph/` 一律只读

## 1. 一句话结论

**需修订**：0.4.0 的构建、测试、打包、发布彩排与拓扑状态流转经独立取证全部成立且质量高于 0.3.0，但「config v2 fail-closed」与「README/AGENTS/CHANGELOG 与实现一致」两条验收标准在 **`evofence run` 路径上不成立**——同一份 `contract.yaml`/`config.yaml` 被两套校验器给出不同结论，`run` 不拒绝未知字段、也不 apply 声明的 120000 默认超时（实测被 1 ms 杀掉 evidence 命令）。修掉 F1/F2（或据实收窄文档表述）即可签署。

## 2. A 规格轴：8 条成功标准逐条对照

| # | 标准 | 结论 | 关键证据（复核人实测） |
|---|---|---|---|
| 1 | 拓扑：存在 + 人审 approve + 工作流节点 passed + validate 0 error + 状态流转经正规通道 | **成立** | `graph validate` → `ok:true, errors:[], warnings:[], 29 节点/39 边`；`design_approved by=Calvin-Xia` (06:23:12Z) 与 `graph.yaml review.status=approved` 一致；19 个工作流节点中 17 passed、`l5_review` running（本节点）、`l5_accept` pending。事件对照：19 个节点**无一存在无法由事件解释的状态**——17 个 passed 节点全部是 `pending→ready→ready→running(claim by X)→…→running→passed` 且带 `execution_report`+`verdict`+checkpoint；5 个 ADR 的 accepted 由 `adr_accepted` 事件解释；5 个 ctx 与 l5_accept 停在创建时的 pending（`node_created to:pending`）。脚本核对 0 处缺环 |
| 2 | TypeScript：tsc 0 error、build 产 ESM JS+d.ts+declarationMap、package.json 指向 dist、全部子命令冒烟 | **成立** | `npx tsc --noEmit` EXIT=0；`npm run typecheck` EXIT=0；`npm run build` 产出 102 `.js` + 102 `.d.ts` + 102 `.d.ts.map`（与 102 个 `src/**/*.ts` 一一对应）；`bin=dist/cli.js`、`exports["."].types=./dist/index.d.ts`、`types=./dist/index.d.ts`、`files` 含 `dist/`；`node dist/cli.js --help` EXIT=0 且 15 条命令与 `catalog.ts` 逐条对齐；`--version`/`-v` 输出 0.4.0；在临时仓库实跑 `init/status/status --json/ledger show|verify|recent|export` 全 EXIT=0；`status extra-arg`、`--bogus-flag`、`run` 缺 `--goal`、`ledger verify --extra`、未知命令 全部 EXIT=1，`--json` 时 stdout 为空且 stderr 是**单个** `{"error":{...}}`；`--goal=goal.md` 形式被接受（＝`--flag=value` 成立）。`test/cli-surface.test.js` 另以 `COMMANDS` 清单驱动全部 15 条（smoke/jsonSmoke/非法 flag/manifest↔handler 一致性） |
| 3 | 模块化：按域拆分、单文件 ≤350 行、依赖无环、858 行单体确实被拆 | **成立（含一处无门禁，见 F11）** | 102 个 `.ts`，10 730 行 vs 0.3.0 的 18 个 `.js`、4 419 行；最大文件 **350 行**（`src/lib/pi-tool-strategy.ts`，恰好压线）；0.3.0 最大文件 `src/lib/runner.js` **858 行** → 现 `src/lib/runner.ts` 14 行门面 + `src/lib/exec/` **21 个模块**（1 866 行）；0.3.0 `src/lib/adapter.js` 584 行 → `adapter.ts` + `exec/adapter-*`。`npm run dep:check` → `modules:102 edges:364 cycles:0 acyclic:true` EXIT=0，且我独立验证该脚本**不是空跑**：把 `src/` 复制到临时目录注入 2 文件互相 import → `cycles:1 / acyclic:false`（退出码 1）。域目录：`types/ lib/{audit,cli,cli/handlers,config,exec,gate,ledger,report}`（注：派单文档写的 `src/ledger/**` 等路径与实际 `src/lib/**` 不符，见 F6） |
| 4 | 测试：npm test 0 failures（给用例数）、映射表覆盖 12 个旧文件、哈希链负向测试断言足够强 | **部分成立** | `npm run check`（typecheck+dep:check+test）EXIT=0，**tests 233 / pass 233 / fail 0**；`npm run test:e2e` EXIT=0，**24/24**。我在临时目录检出 `v0.3.0` 实跑旧 12 个测试文件 = **152 例**，与映射表「§9 用例数」12 行逐行吻合。映射表 12 条条目 ↔ 0.3.0 的 12 个测试文件**逐条可达、无缺项**，但两行「现状用例数」已过期（`integrations` 记 2 实为 4、`release` 记 4 实为 14），合计「221」与实测 233 差 12 → 计数不成立（见 F9）。哈希链负向断言：我通读 `test/unit-ledger-chain.test.js` 并用**自己写的**篡改台（丢弃 append-only 触发器后直改 SQLite）复现：pristine `{valid:true,events:3,head:…}`；payload 改写 → `{valid:false,sequence:2,expected_previous_hash:…,observed_hash:…}`；`event_hash` 改 `f*64` → `observed_hash` 回显 `f*64`；删行 → `sequence:3`。用例侧还额外用 `rehashRow()` 自证「行内摘要自洽、只有链/seq 判定能命中」，属**不可轻易绕过**的强断言 |
| 5 | 发布流水线就绪 + **独立确认未真实发布** | **成立** | `npm pack --dry-run --json` → 418 文件，按顶层分布 `dist:408, templates:4, package.json/LICENSE/README×2/CHANGELOG/docs-pi-tool-strategy`，**`src/` 0 条、`test*` 0 条、非 `.d.ts` 的 `.ts` 0 条**、`.d.ts` 102、`.d.ts.map` 102；`npm publish --dry-run` EXIT=0（`Publishing to https://registry.npmjs.org/ with tag latest and default access (dry-run)`），且工作区未留下 `.tgz`；`ci.yml` 步骤 `install→typecheck→build→dep:check→test→test:e2e→pack`，矩阵 ubuntu+windows × Node 22/24；`publish.yml` 有 `contents:read` + **`id-token:write`** + `npm install --global npm@11.17.0` 且自校验 `test "$(npm --version)" = "11.17.0"`，`Type-check`/`Build dist` 在 `npm publish` 之前；`node scripts/verify-publish-workflow.js` EXIT=0，`RELEASE_TAG=v0.4.0 node scripts/verify-release-metadata.js` EXIT=0。**未发布三项独立佐证**：`npm view evofence version` → **0.3.0**（registry 上无 0.4.0）；`git tag -l` → `v0.2.0/v0.2.1/v0.3.0`，无 `v0.4.0`；`git rev-list --count origin/main..main` = **26**，`origin/main` 仍停在 `5b51dae chore(release): prepare v0.3.0`（推过的 reflog 条目属于 v0.3.0 时代） |
| 6 | 文档与实际实现一致；CHANGELOG 0.4.0 标 BREAKING 且写明旧 ledger/config 不兼容不迁移 | **部分成立** | 成立部分：`CHANGELOG.md` 首段 `## 0.4.0 — BREAKING`，四小节分列源码/发布形态、CLI 命令面、config v2、`ledger schema v2 — BREAKING, no migration`，并有「Upgrading 0.3.0 → 0.4.0」6 步（明确「0.4.0 cannot read it」「not carried forward」）；`dist/index.js` 实测导出 **18** 个符号，与 CHANGELOG「the 18 symbols」一致；README 中 `evofence <cmd>` 示例（含 `report reports/…` 这类被 ASCII 匹配放大的项）经逐条还原后无越界命令，`README.md` 里出现的 `npm run lint`/`benchmark:score` 是**示例 contract.yaml 的内容**而非本项目脚本，不算矛盾；AGENTS.md/CHANGELOG 引用的路径（`docs/config.md`、`docs/pi-tool-strategy.md`、`src/lib/gate/dead-keys.ts` 等）全部存在。**不成立部分**：CHANGELOG §③ 与 AGENTS.md「Config v2」都写「Unknown fields are rejected … go through one v2 validator」——实测 `run` 路径不走该校验器（F1）；`status --json` 多出 `policy` 键而 `StatusView` 未声明（F8a）；`report <file> --json` 的 stdout 不是 JSON（F8c） |
| 7 | herdr 审计：模型白名单、pane↔agent↔claim_by 对应、并行写有 worktree 隔离 | **部分成立** | 白名单**成立**（旁证非台账）：我逐个解析 `~/.pi/agent/sessions/**/2026-09-27*.jsonl` 的 `model_change`/`thinking_level_change` 记录，16 个会话中 14 个 `deepseek/deepseek-flash · high`、1 个 `xiaomi/mimo-v2.6-pro · high`、1 个是编排会话（`deepseek/deepseek-flash · thinking=max`，非派单执行 agent），**无白名单外模型**。并发**成立**：按会话起止时间窗求重叠峰值 = **4**（06:46:22Z 起 `wt-ledger/wt-gate/wt-exec/wt-io` 四窗口重叠），第二波（unit/e2e/integ）峰值 3，第三波（docs/ci→release）峰值 2。worktree 隔离**成立**：10 个 worktree 会话 ↔ `git worktree list` 的 10 个检出，逐域对应，`main` 上的写者只有编排会话（§3 允许）与 base 串行阶段。**不成立部分**：派单红线「并行写者不得共用同一文件」被破 6 处（见 F5）；§4/§5 台账未登记 L3/L4 与复核角色、pane id 无法独立复核（见 F6/C 节） |
| 8 | 产品内核不变式：自造篡改确认失败 + config/ledger 两处 fail-closed + 文档不得把 worktree 隔离说成 OS 沙箱 | **部分成立** | ledger fail-closed：**我自己构造篡改**（不参考 `test/unit-ledger-chain.test.js` 的 helper）——`new Ledger()` seed 3 事件 → 在带触发器时 UPDATE/DELETE 均抛 `events are append-only`，且实测存在 4 个触发器 `events_no_update/events_no_delete/generations_no_update/generations_no_delete`；丢弃触发器后改 `payload_json`/`event_hash`/删行，`verify()` 分别返回精确的 `sequence` 与 `expected_previous_hash`/`observed_hash`。0.3.0 形态账本（只有 `events` 表）→ `status` EXIT=1 `LEDGER_UNAVAILABLE`，消息明确「declares no schema version marker … no migration is provided (adr_0001)」。config fail-closed：`status` 对未知字段 → `INVALID_CONTRACT`(rejected_fields)、`contract_version: 99` → `UNSUPPORTED_CONTRACT`、缺必填 → `missing field(s)`，全部 EXIT=1。**但 config 的 fail-closed 只覆盖 `init`/`status`，`run` 路径不成立**（F1/F2）。沙箱措辞：`README.md:219`/`README.en.md:217`/`AGENTS.md:37`/`docs/pi-tool-strategy.md:25` **明确否定**「worktree 隔离＝OS 沙箱」，**无过度宣称** |

### A 轴补充：我另做的两项独立探针

1. **`dep:check` 有效性**（防「空跑门禁」）：临时目录注入 `src/probe/a.ts ⇄ b.ts` 互 import → `cycles: 1`、`acyclic: false`、退出码 1。该脚本是真 DFS 回边检测（364 条边），不是空转。
2. **`npm run check` 整链**：EXIT=0，233/0。

## 3. B 惯例轴：L2–L4 逐节点产物复核

判定口径：产物是否与其 DoD 相符 + 是否越界/遗留/前后不一致 + 跨域命名与形状是否一致 + 是否有未被测试保护的高风险面。

| 节点 | 结论 | 核对要点与实测 |
|---|---|---|
| `l2_types` | 相符（1 处计数笔误） | 10 文件全部 `≤350`；`src/types/**` 运行时依赖为 0（只有 `import type`）；`dist/types/*.d.ts` 存在。DoD 5「逐文件行数清单列入执行报告」——报告给的是总量与逐项摘要，实测 **1 689 行** vs 报告 **1 683 行**（F9）。`src/types/config.ts` 顶部把 `capabilities.*` 标注为「read but not…」属实 |
| `l2_ledger` | 相符，且是全图**唯一有独立作者身份证据**的域 | v2 变更点仅 `state.schema_version`；0.3.0 账本显式拒绝（我复现）；哈希链 recipe/DDL/触发器/write order 未变（我的篡改台与 0.3.0 语义一致）；报告自述「单 worktree 内曾因未认领的 spec 文件指向 `src/` 而红（100/151），已由主检出 `c0dfc56` 统一迁移」——此自述与 F5 的重复劳动现象吻合（同一次 import 迁移被 io 与该域各做一遍） |
| `l2_gate` | **部分成立**（本图最重要的遗留） | DoD 1/2/4/5/6 成立：`src/lib/gate/` 文件全部 ≤350（最大 169）；`external_api` 是动态查表活门（`capabilitySetting` 索引 `contract.capabilities[...]`）；三个死键建立了 `DEAD_CONTRACT_KEYS` 台账。**DoD 3 的落点有实质缺陷**：6 个新判定入口 `evaluateBudgetGate/EvidenceGate/PolicyGate/CapabilityGate/IsolationGate/ContractGate` + `verdictForEvidence/verdictForRisk/decisionForCandidateCheck` 在 `src/` 内**零生产调用点**（`evaluateBudgetGate` 唯一出现在 `src/lib/policy.ts` 的注释里），全部引用来自 `test/contract-policy.test.js`（F3）。报告自述「17 个判定模块」实测 **14**（F9）。报告主动上报的「接线前两处实现并存」**合并后仍然并存**，且已从「并存」恶化为「签名漂移」：`gate/budget.ts` 与 `exec/budget.ts` 的 `parseNumericBudget` 逐字节相同，`usdToMicros`/`usdFromMicros` 已不同（gate 参数类型放宽为 `unknown`）。`dead-keys.ts` 里「no reference under src/」的证据串可被 grep 证伪（F10） |
| `l2_exec` | 相符（1 处计数笔误） | 858 行单体 → 21 模块，最大 263 行；`worktreeTempParent/repositoryId/cleanupEmptyWorktreeTempParent` 三个观察点已接线到 `runner-run.ts` 收尾；报告「20 个模块」但其自列清单与 `ls` 都是 **21**（F9）；报告自述的历史 174 个 `<TMPDIR>/evofence-worktrees/*` 残留，我实测当前 26 个目录、其中空目录仅 2 个——不构成运行时回归（父目录清理已生效，`test/unit-worktree-cleanup.test.js` 用真实 `git worktree add` 断言 `openTreeCount` 2→1 并锁定空父目录回收） |
| `l2_config` | **部分成立**（F1/F2 的源头） | 三场景（合法/未知字段/缺必填）在 `status` 上全部符合 DoD；「不为缺失字段新增代码默认值」成立（`schema.ts` 只有 `CONTRACT_DEFAULTS` 两个键）。报告**如实上报**了范围收敛：「`loadConfig` 实现在 runner.js（exec 域），本节点不越域，v2 校验只在 status/init 接线；runner 侧接线需求已如实上报」，并把「cli.js 把配置错误码吞成 LEDGER_UNAVAILABLE」作为 handoff 交给 `l2_cli`（该 handoff 已闭环）。问题在于这条上报被 `verification` 判为「不构成未达标」后，**run 路径的接线从未落地**，而文档改成了全域口径（F1）。另：`src/lib/config/load.ts:116` 的注释白纸黑字写着「adopting this one is **an L3 decision** because it additionally rejects unknown keys」——即分歧是**代码内已知并被显式延期**的 |
| `l2_report` | 相符（1 处类型漂移） | 388 行 → `report.ts` + 9 个视图模块，`status.ts` 128 行；`report --json`/`status --json` 可解析且字段齐；非法输入下错误对象可解析。报告自述 status 顶层键含 `policy`（6 个），但 `src/types/report.ts::StatusView` 只声明 5 个（F8a）——两处不一致，且无编译期联动所以无人发现。报告主动收缩了 `--json` 错误信封的适用范围（只覆盖 report/status，因 `spec-f1` 锁定了 diff 的文本格式），并把它作为 handoff 交给 `l2_cli`；`l2_cli` 后来确已扩散到全部命令，该 handoff 闭环 |
| `l2_cli` | 相符（1 处 catalog↔行为不一致） | `cli.ts` 实测 **62 行**（报告称 62，准确）；`src/lib/cli/` 18 模块全部 ≤350，`catalog.ts` 273 行为唯一 manifest；`--help` 由 manifest 生成、15 条命令实测一致；`--json`/退出码/`--flag=value`/未知 flag 全部符合 DoD 1–4；F1 的两处被锁定断言改为「exit 1 + stdout 空 + 解析 error.code」加强形式（我核对了 `test/spec-f1.test.mjs` 的改动方向，未删用例）。**DoD 2 有反例**：`report <file> --json` 的 stdout 是 `Report written to rep.json` 而非 JSON，而 catalog 的 `jsonSmoke` 只测 `report --json`（无 file），故该形态无测试（F8c） |
| `l3_tests_unit` | 相符（1 处计数不自洽） | 新增 `docs/test-coverage-map.md`（12 条 ↔ 0.3.0 的 12 个文件，我在 v0.3.0 实跑 152 例验证基线）与两个补强套件；哈希链用例断言强度我逐条读过并复现（见 A4），worktree 清理用例**先证夹具再断言**（避免空断言）——这类「先断言夹具确实非空」的写法质量高。报告「基线 204 → 223」内部不自洽：本节点贡献 17（11+6），该时点应为 221（F9）；映射表文档写 221 是对的，但实测终值 233，两行现状数未更新（F9） |
| `l3_tests_e2e` | 相符 | `test-e2e/cli-flow.mjs` 658 行独立于 `npm test`（实测 `node --test` 确实不拾取它，需要 `npm run test:e2e`）；24 用例我实跑 0 失败；覆盖 15 个命令组且 `run`/`experiment` 用桩适配器跑通闭环（非受控失败占位）；失败路径含 `INVALID_CONFIG` 与「篡改哈希链后 `ledger verify` exit 1」；`npm run check` 不含它、`ci.yml` 显式加了一步。**注意**：其 `stderr` 断言为 `doesNotMatch(/^\[[A-Z_]+\]/m)` + 无堆栈，因此**无法发现** Node 打到 stderr 的 `TimeoutNaNWarning`（F2） |
| `l3_integrations` | 相符 | `find src -name '*.js'` = **0**（报告称「残留清零」，属实）；`integrations/` 调用面我逐条 grep：只有 `evofence run`、`evofence ledger verify/recent/show` 与两个只读工具名，无旧命令面残留，与报告一致；`integrations/deepseek-harness` 的 `evofence` 依赖与 README 已钉到 **0.4.0**（报告把「版本升到 0.4.0 后该声明须同步」列为待跟踪，`l4_release` 已闭环）；`.pi/extensions/evofence.js` 存在。**越界判定**：本域改了 `src/lib/pi-tool-strategy*.ts` 两个文件，属 §3 里未分配给任何域的「仓库自带扩展加载面」，报告已明确声明该边界扩张理由 |
| `l4_docs` | 相符（承 F1 的表述过宽） | README/README.en/AGENTS/CHANGELOG 四文件 + 新增 `docs/config.md`；命令示例、npm 脚本、ADR 编号引用全部可解析；CHANGELOG 的 BREAKING 与「不迁移」表述完整（我另核 `dist/index.js` 导出 18 个符号，与文案一致）；沙箱措辞专项检查通过（三处明确否定）。DoD 5（死键说明）成立。**唯一实质问题是它照抄了 CHANGELOG 的口径**，把「未知字段被拒」写成全域事实（F1）——即 l4_docs 的 DoD 4「文档不出现未实现的功能描述」在此处未达标 |
| `l4_ci` | 相符 | `ci.yml` 步骤与顺序我逐行核对：`typecheck`/`build` 在 `test` 之前，矩阵 `ubuntu-latest+windows-latest × 22/24`，含 `dep:check`、`test:e2e`、`npm pack --dry-run`；报告说明的两处补强理由（`dep:check` 此前 CI 从不运行；`test-e2e/` 在 `node --test` 默认发现路径外）我实测证实（`npm test` 不拾取 `test-e2e/`） |
| `l4_release` | 相符 | 六项 DoD 我全部独立复现（见 A5），其中「未真实发布」由 `npm view`、`git tag`、`origin/main` 三路交叉确认；`scripts/verify-publish-workflow.js` 为新增静态守卫并实跑 EXIT=0；`verify-release-metadata.js` 适配 0.4.0 后 `verifyPublishSurface` 实跑 EXIT=0；报告「`.d.ts 204`」实为 `.d.ts` 102 + `.d.ts.map` 102（口径略松但可解释）；报告主动上报并闭环了跨域红灯（`test/integrations.test.js` 断言版本钉住 → 232/233 → 修 integrations 后 233/0），边界纪律正确（未越界改 `integrations/`，由编排会话落）

### B 轴专项

- **跨域一致性**：`config`/`gate`/`report` 三域的对外形状有三处真实漂移 —— `StatusView` 缺 `policy`（F8a）、`GateJudgementBase` 不在 `src/types/`（F8b）、`report <file> --json` 的 stdout 非 JSON（F8c）。反向地，`status --json` 的 `integrity{valid}`/`totals{runs,generations,accepted_candidates,rejected_candidates}` 与 `types/report.ts` 声明完全一致，说明命名约定本身是统一的，漂移只发生在「新加字段未回写类型」这类增量处。
- **未被测试保护的高风险面**（本项最有价值）：① `run` 路径的配置校验（F1）——没有任何用例断言 `run` 拒绝未知字段；② `evidence.per_command_timeout_ms` 的默认值（F2）——所有夹具都显式写了该键，无一例覆盖省略形态；③ `report <file> --json` 的输出形态（F8c）；④ ≤350 行硬指标（F11）；⑤ src 下出现 `.js` 会使类型检查静默失效（F4）；⑥ 生产判定路径（exec 内联逻辑）只由 `test/runner.test.js` 2 个用例覆盖，而 `test/contract-policy.test.js` 的 8 个新用例覆盖的是生产不调用的 gate 判定（F3）。
- **dead code / 未接线实现**：确证存在且比上报的更严重 —— `src/lib/gate/` 14 个模块中，`dead-keys.ts` 与 `fail-closed.ts` 在 `src/` 内**无任何导入者**；14 个模块共 **48 个导出**在 `src/lib/gate/` 之外零引用（含全部 6 个 `evaluate*Gate`、3 个 `verdict*`）。同时 `exec/budget.ts` 与 `gate/budget.ts` 保留两份金额换算原语，且已签名漂移 → 机能重复 + 行为漂移风险**都已现实存在**。

## 4. C 派单审计核对

`台账 pane` = `docs/refactor-dispatch.md` §5 自述；`session cwd`/`模型` = 我从 `~/.pi/agent/sessions/**/2026-09-27*.jsonl` 的 `session.cwd` 与 `model_change`/`thinking_level_change` **独立解析**（非台账）；`分支/提交` = git 独立证据。

| 节点 | claim_by | 台账 pane | session cwd（独立） | 模型（独立） | 分支 / 提交 | worktree 隔离证据 |
|---|---|---|---|---|---|---|
| `l1_recon` | `herdr-recon` | wA:p2 | `EvoFence`（主检出） | deepseek-flash · high | main（串行） | §3 base 串行阶段，允许 |
| `l1_design` | `herdr-designer` | wA:p3 | `EvoFence` | **mimo-v2.6-pro · high** | main（串行） | 同上 |
| `l1_base` | `herdr-base` | wA:p6 | `EvoFence` | deepseek-flash · high | main（串行） | 同上 |
| `l1_dispatch` | `herdr-base` | 未登记 | 同上（同会话） | deepseek-flash · high | main | 同上 |
| `l2_types` | `herdr-base` | 未登记 | 同上（同会话） | deepseek-flash · high | main | 同上 |
| `l2_ledger` | `herdr-ledger` | wA:p8 | `evofence-wt-ledger` | deepseek-flash · high | `refactor/ledger` → `235020f` | ✓ 独立检出；**该提交作者身份为 `herdr-ledger <herdr-ledger@evofence.invalid>`**（全图唯一带 agent 身份的提交） |
| `l2_gate` | `herdr-gate` | wA:p9 | `evofence-wt-gate` | deepseek-flash · high | `refactor/gate` → `a3392fc` | ✓ 独立检出，改动限 `src/lib/gate/**` + `src/lib/{policy,contract,evidence}.ts` |
| `l2_exec` | `herdr-exec` | wA:pA | `evofence-wt-exec` | deepseek-flash · high | `refactor/exec` → `31db3cf` | ✓，改动限 `src/lib/exec/**` + 4 个门面 |
| `l2_config`/`l2_report`/`l2_cli` | `herdr-io` | wA:pB | `evofence-wt-io` | deepseek-flash · high | `refactor/io` → `03096f2`/`248ffc9`/`588a215` | ✓ 独立检出（一个 pane 串行认领 3 个节点，符合「一个 pane 同一时刻只持一个 running 节点」） |
| `l3_tests_unit` | `herdr-unit` | 未登记 | `evofence-wt-unit` | deepseek-flash · high | `refactor/l3-unit` → `c10c3e6` | ✓ |
| `l3_tests_e2e` | `herdr-e2e` | 未登记 | `evofence-wt-e2e` | deepseek-flash · high | `refactor/l3-e2e` → `8a0aa65` | ✓ |
| `l3_integrations` | `herdr-integ` | 未登记 | `evofence-wt-integ` | deepseek-flash · high | `refactor/l3-integ` → `2537050` | ✓ |
| `l4_docs` | `herdr-docs` | 未登记 | `evofence-wt-docs` | deepseek-flash · high | `refactor/l4-docs` → `fef141a` | ✓ |
| `l4_ci` | `herdr-ci` | 未登记 | `evofence-wt-ci` | deepseek-flash · high | `refactor/l4-ci` → `5ede0fc` | ✓ |
| `l4_release` | `herdr-release` | 未登记 | `evofence-wt-release` | deepseek-flash · high | `refactor/l4-release` → `efb54c9`,`4c4971f` | ✓ |
| `l5_review` | `herdr-review2` | 未登记 | `EvoFence`（本会话 `wA:pK`） | deepseek-flash · high | 未提交（只读复核） | 只读，不写被复核产物 |

**四个必答问题**

1. **并发写者峰值是否 ≤4** —— **是，峰值恰为 4**。按 16 个会话的起止时间窗求重叠：`06:46:22Z` 起 `wt-ledger/wt-gate/wt-exec/wt-io` 四窗口重叠（第一波）；`07:53Z` 起 unit/e2e/integ 三窗口（峰值 3）；`08:25Z` 起 docs/ci 两窗口（峰值 2），release 单独。四窗口的 `session.cwd` 全部是不同的 worktree。主检出上的写者只有编排会话（§3 允许）。
2. **是否存在白名单外模型** —— **不存在**。16 个 9-27 会话：14 × `deepseek/deepseek-flash · high`、1 × `xiaomi/mimo-v2.6-pro · high`、1 × 编排会话 `deepseek/deepseek-flash · thinking=max`。**唯一偏离**是编排会话的 `thinking=max`（派单 §1 要求「thinking 一律 high」），它不是派单执行 agent、也不持有任何节点，故不构成白名单违规，但台账未披露该会话。
3. **是否存在无 worktree 的并行写** —— **不存在**。10 个 worktree 会话 ↔ 10 个现存 `git worktree`，三波并行波全部落在各自检出；其余 6 个主检出会话中 3 个属 §3 允许的 base 串行阶段、1 个是只读盘点复核、1 个是编排会话、1 个是本次复核。
4. **pane ↔ agent ↔ 节点 claim_by 是否一一对应** —— **在「一个 claim_by ↔ 一个会话 ↔ 一个 worktree」这一层成立；在 pane id 这一层无法独立验证**。`claim_by` 与 `execution_report`/`verdict` 事件一一对应（19 节点无重复认领），每个 claim_by 都对应一个 cwd 匹配的会话。但 §5 台账的 pane id 列（`wA:p8` 等）除本会话 `wA:pK` 外，在会话文件中无痕，属**不可独立复核的自述**；`herdr-review2` 与 L3/L4 六个角色都未登记进 §4 命名表（违反 §4「新增角色需先在本表登记」）。

## 5. 发现清单

### F1 · 重要 · `run` 与 `status` 对同一份配置文件给出不同结论，未知字段在 `run` 路径不被拒绝

- 位置：`src/lib/gate/contract-document.ts::validateContract`（0.3.0 逐字搬迁、无 `additionalProperties` 语义、第一个违规即 throw）vs `src/lib/config/{schema,validate,load}.ts`（v2 校验器，产出 `rejected_fields/missing_fields`）；运行路径 `src/lib/exec/runner-preflight.ts:39`、`src/lib/exec/runner-events.ts:40` 走前者；`src/lib/config/load.ts:116` 注释自认「adopting this one is an **L3 decision** because it additionally rejects unknown keys」；文档口径 `CHANGELOG.md` §③、`AGENTS.md`「Config v2」、`README.md`/`docs/config.md`
- 证据（临时仓库，同一份文件）：
  - `contract.yaml` 追加 `unknown_toplevel_key: 42` → `evofence status --json` **EXIT=1**，`{"error":{"code":"INVALID_CONTRACT",...rejected_fields:[{"path":"unknown_toplevel_key"}]}}`
  - 同一目录 `evofence run --goal goal.md --json` → **EXIT=1 但错误是 `NO_EVIDENCE_CONFIGURED`**（即已接受该文件、继续做内容判定），**从未提及未知字段**
  - `loadContract(repo)` 直接返回成功，且返回对象里 `unknown_toplevel_key === 42`；`exec loadConfig(repo)` 同样接受未知键
- 建议修法：把 `run` 路径的 `loadContract`/`loadConfig` 换成 `config/load.ts` 的 `loadRequiredContractDocumentSync`/`loadRequiredConfigDocumentSync`（代码注释已把它标为待决 L3 决策，正是本图该拍的板）；若确定不做，则把 CHANGELOG/AGENTS/README/docs/config.md 的「未知字段被拒绝」统一收窄为「`init`/`status` 会拒绝，`run` 沿用 0.3.0 宽松读取」，并补一条断言该口径的用例。

### F2 · 重要 · 声明的 `per_command_timeout_ms = 120000` 默认值不生效，省略该键时 evidence 命令被 1 ms 超时杀掉并污染 stderr

- 位置：`src/lib/evidence.ts:83-88::boundedTimeout`（`const perCommandTimeoutMs = contract.evidence.per_command_timeout_ms as number; return Math.max(1, Math.min(perCommandTimeoutMs, remaining))`）；默认值只存在于 `src/lib/config/fields.ts:43-45`（v2 侧 materialize）与 `src/lib/gate/contract-document.ts`（仅用于 range check 的 `?? 120000`，不回写文档对象）；`run` 不走 v2 侧 → 得到 `NaN` → Node 把 `setTimeout(NaN)` 降为 1 ms
- 证据（临时仓库，同一脚本文件 `slow.js` 睡 200 ms 后输出 `0.9`；两个校验器都判定省略该键合法）：
  - 省略该键：`evofence evidence run . --json` **EXIT=1**，`result:"TIMEOUT"`、`duration_ms:564`，stderr = `(node:47284) TimeoutNaNWarning: NaN is not a number.\nTimeout duration was set to 1.`
  - 写入 `per_command_timeout_ms: 120000`：同一命令 **EXIT=0**，`result:"PASS"`、`duration_ms:323`，stderr 为空
  - `evofence run --goal goal.md --json` 在省略该键的仓库同样打出该 warning（`evofence` 的 `--json` 契约要求「stdout 为空、stderr 一个 JSON 对象」，此时 stderr 被 Node 警告占据）
- 建议修法：在 `boundedTimeout` 用 `contract.evidence.per_command_timeout_ms ?? CONTRACT_DEFAULTS['evidence.per_command_timeout_ms']`（`max_output_bytes` 在 `evidence.ts:105` 是同型写法，一并核）；或让 gate 侧 `validateContract` materialize 默认值。补一条「省略两个默认键时 evidence 应 PASS 且 stderr 为空」的用例——现有夹具全部显式写了该键。

### F3 · 重要 · gate 域 6 个 `evaluate*Gate` + 3 个 `verdict*` 判定入口零生产调用点；金额换算原语两份且已漂移

- 位置：`src/lib/gate/{budget,evidence,paths,capability,isolation,contract,verdict}.ts`、`src/lib/gate/fail-closed.ts`、`src/lib/gate/dead-keys.ts`；对照 `src/lib/exec/budget.ts`
- 证据：
  - 全量扫描 `src/**/*.ts`：`src/lib/gate/` 之外**对 48 个 gate 导出的引用为 0**；`evaluateBudgetGate`/`evaluateEvidenceGate`/`evaluatePolicyGate`/`evaluateCapabilityGate`/`evaluateIsolationGate`/`evaluateContractGate`/`verdictForEvidence`/`verdictForRisk`/`decisionForCandidateCheck` 只出现在 `src/lib/policy.ts` 的**注释里**
  - `src/lib/gate/dead-keys.ts` 与 `fail-closed.ts` 在 `src/` 内**无任何导入者**
  - 双份原语：`parseNumericBudget` 在 `gate/budget.ts` 与 `exec/budget.ts` **逐字节相同**；`usdToMicros`/`usdFromMicros` 已不同（gate 侧参数放宽为 `unknown`）
  - `test/contract-policy.test.js` 的 8 个新用例（含「budget judgement keeps the 0.3.0 thresholds and fails closed on missing counters」）断言的是**生产不执行**的那份实现；生产路径（`exec/runner-budgeted.ts` 的 `remainingTokens < 1`、`recordTokenUsage`）只由 `test/runner.test.js` 的 2 个用例覆盖
- 风险：测试给出「fail-closed 已锁定」的信号，实际锁的是另一份代码；日后只修 gate 侧（或只修 exec 侧）不会互相影响，行为漂移无测试可察
- 建议修法：二选一并写进文档——(a) 把 exec 接线到 gate 判定、删掉 exec 的重复原语；(b) 明确把 `evaluate*Gate` 标为「未接线的参考实现」，在 `test/contract-policy.test.js` 的用例名/注释里注明它不锁定运行路径，并给生产判定路径补用例（至少一条 `RESOURCE_EXHAUSTED` + 一条 `*_USAGE_UNAVAILABLE`）。

### F4 · 重要 · `tsconfig.json` 的迁移期开关未拆，`src/**/*.js` 零类型检查地编进 dist 并随包发布

- 位置：`tsconfig.json` 的 `"allowJs": true`、`"checkJs": false`、`"include": ["src/**/*.js","src/**/*.ts"]`（文件内注释自述「Removing it after L2 finishes migrating every src/ domain to TypeScript is a one-line change」；实测 `src/` 已 **0** 个 `.js`，L2 早已结束）
- 证据（临时目录，复制该 tsconfig）：
  - 放入故意写错的 `src/sneaky.js`（`a.thisMethodDoesNotExist()` + 裸 `undefinedVar`）→ `tsc --noEmit` **EXIT=0**
  - `tsc` 构建 **EXIT=0**，且 `dist/sneaky.js` 被 emit，内容含 `exports.bad = undefinedVar;`
  - 即：`npm run typecheck`、`npm run check`、CI 的 typecheck 全部对其视而不见，而 `files:["dist/"]` 会把它发给用户
- 建议修法：删掉 `allowJs`/`checkJs` 两行与 `include` 里的 `src/**/*.js`（注释自己说的 one-line change），并在 CI 加一条 `src 下不得存在 .js` 的断言。

### F5 · 重要 · 派单红线「并行写者不得共用同一文件」在 L2 四并发波被破 6 处

- 位置：`docs/refactor-dispatch.md` §3 文件所有权 + §6 红线；涉事提交 `235020f`(ledger)、`a3392fc`(gate)、`31db3cf`(exec)、`03096f2`(io)
- 证据：四个提交的 `parent` **都是 `34b193f`**（真并发，非时序先后），且都改了同一批测试文件的 import 路径；`git diff` 逐文件比对：
  - `test/ledger.test.js`（ledger × io）→ 两侧**逐字节相同**
  - `test/adapter.test.js`、`test/git.test.js`、`test/process.test.js`、`test/runner.test.js`（exec × io）→ 两侧**逐字节相同**
  - `test/contract-policy.test.js`（gate × io）→ 两侧**相差 209 行**（gate 新增 8 例，io 只改 import）；因 hunk 不重叠被 git 自动合并，**侥幸**无冲突、无内容丢失（终态 14 例含全部 8 个 gate 用例，全库无冲突标记）
  - 根因：ADR-0004 的「测试 import 迁移到 dist」没有被指派给单一 pane，io 与三个域 pane 各自做了一遍
- 建议修法：把「跨域共用文件」（`test/**`、`src/index.ts`、`package.json`）在派单里显式指派给一个 pane；合并前加一道「两分支 touched-file 交集非空即停下上报」的检查。

### F6 · 轻微 · 派单台账未登记 L3/L4 与复核角色，pane id 不可独立复核；§3 所有权路径与实际布局不符

- 位置：`docs/refactor-dispatch.md` §3（写 `src/ledger/**`、`src/gate/**`、`src/exec/**`、`src/io/**`，实际为 `src/lib/**`）、§4（命名表只有 designer/recon/review/base/ledger/gate/exec/io）、§5（台账只到 L2 波）
- 证据：L3/L4 的 6 个 `claim_by`（`herdr-unit/e2e/integ/ci/docs/release`）与本节点的 `herdr-review2` 均不在 §4；17 个 `passed` 节点的 `claim_by` 里 8 个在 §5 台账中无行；§4 明写「新增角色需先在本表登记」。会话文件中 pane id 仅在本会话可查（`HERDR_PANE_ID=wA:pK`），其余 15 个会话无 pane 痕迹
- 建议修法：回填 §4 命名表与 §5 台账（L3/L4 波次 + pane id），或把 §3/§4 标注为「L2 阶段快照」并把 pane 映射改为由编排会话在 `graph events` 里留痕。

### F7 · 轻微 · 交付所依赖的 ADR/context 文档与图导出未纳入 Git；仓库根有 `nul` 垃圾文件

- 位置：`docs/adr/*.md`（5 个 ADR）、`docs/contexts/*.md`（5 个）、`CONTEXT-MAP.md`、`DECISIONS.md` —— 全部 `git status` 显示 **untracked**；`nul`（180 B，Windows 重定向产物）
- 证据：`git ls-files | grep -i adr` → 无 ADR 文档；而 `AGENTS.md`、`CHANGELOG.md`、`README.md`、`src/lib/ledger/{chain,schema,ledger}.ts`、`src/types/shared.ts` 都以 `adr_0001`/`ADR-0002/0003/0004/0005` 编号引用它们（`.gitignore` 并未忽略这些路径）
- 影响：fresh clone 拿不到任何决策记录，而 ADR 是本交付「破坏性变更已获授权」的唯一书面依据
- 建议修法：`git add docs/adr docs/contexts CONTEXT-MAP.md DECISIONS.md`（或明确改为「决策只存于图」并把编号引用换成图内指针）；删除 `nul`。

### F8 · 轻微 · 三处跨域类型/输出契约漂移

- (a) `status --json` 实际顶层键 6 个（`root, active_generation, integrity, recent_runs, totals, **policy**`），而 `src/types/report.ts::StatusView` 只声明 5 个 —— 声明与实现不一致，TS 消费方看不到 `policy`（无编译期联动，故无人发现）
- (b) `GateJudgementBase`（`{passed, reason, missing}`，全部 gate 判定的公共信封）声明在 `src/lib/gate/fail-closed.ts` 而非 `src/types/` —— 与 ADR-0005「types 是唯一类型底座」相悖，且 `src/types/gate.ts` 已声明同一层的 `BudgetGateInput`/`BudgetGateResult`/`ContractGateResult`（我实测 `src/types/**` 中 `GateJudgementBase` 出现 0 次）
- (c) `report <file> --json` 的 stdout 是 `Report written to rep.json`（非 JSON），而 `report --json`（无 file）才是 JSON；`catalog.ts` 给 report 的 `jsonSmoke` 只覆盖无 file 形态 → `l2_cli` DoD 2「`--json` 在全部支持的命令上输出可解析对象」对该形态不成立且无测试
- 建议修法：(a) 补 `StatusView.policy`；(b) 把 `GateJudgementBase` 移入 `src/types/gate.ts` 并让 gate 域 re-export；(c) 二选一——写文件形态也在 stdout 输出 JSON 信封，或把该形态从 `--json` 声明中排除并在 catalog 注明 + 补用例。

### F9 · 轻微 · 执行报告与文档的数字与实测不符（夸大/笔误）

- 位置与证据：
  - `l2_gate` 报告「拆出 src/lib/gate/ **17** 个判定模块」→ `git ls-tree a3392fc -- src/lib/gate | wc -l` = **14**，现在也是 14
  - `l2_exec` 报告「exec/ **20** 个模块」→ 其自列清单 21 项，`ls src/lib/exec | wc -l` = **21**
  - `l2_types` 报告「src/types/ 10 文件 **1683** 行」→ 实测 **1689**
  - `l3_tests_unit` 报告「npm test **223** 通过（基线 204 → 223）」→ 本节点只贡献 17（11+6），该时点应为 **221**（223 是把后继 `l3_integrations` 的 +2 提前计入）
  - `docs/test-coverage-map.md` 合计「221」与实测 **233** 差 12：`integrations` 行现状数记 2（实为 4）、`release` 行记 4（实为 14）
- 影响：不影响行为，但削弱「报告数字可被验收抽查」的可信度
- 建议修法：报告中的计数一律从命令输出粘贴；映射表两行现状数更新，或加注「本文为 `l3_tests_unit` 时点快照」。

### F10 · 轻微 · `dead-keys.ts` 的机器可读证据串可被 grep 证伪

- 位置：`src/lib/gate/dead-keys.ts` 的 `evidence: 'no reference under src/; …'`（三条）
- 证据：`grep -rn 'require_proposal\|require_claims' src/` → `src/lib/config/schema.ts:92-93`、`src/lib/config/validate.ts:130`、`src/types/config.ts:77-79` 均有引用（仅做类型校验，不做判定）。`capabilities.shell.mode` 的「no reference」确实成立
- 影响：结论（不是活门）正确，但「可被 grep 验证」这一性质被证伪，`DEAD_CONTRACT_KEYS` 作为机器可读台账的可信度下降
- 建议修法：证据串改为「只在 config 校验层被读（`config/schema.ts`、`config/validate.ts`），没有任何判定路径消费」。

### F11 · 轻微 · 「单文件 ≤350 行」没有任何机器门禁，且最大文件正好压线 350

- 位置：`scripts/`（只有 `check-deps.mjs` 环检查、`verify-release-metadata.js`、`verify-publish-workflow.js`）；`.github/workflows/ci.yml`
- 证据：`grep -rn 'wc -l\|350' scripts/ .github/workflows/` 无任何行数检查；`find src -name '*.ts' | xargs wc -l | sort -rn | head -1` = **350**（`src/lib/pi-tool-strategy.ts`）
- 影响：该指标是图的 exit 标准之一，却只靠人工维持；加一行即回归且无人拦
- 建议修法：加一个约 10 行的 `scripts/check-file-sizes.mjs`（阈值 350）进 `npm run check` 与 CI。

### 未成为缺陷的可疑点（复核澄清）

- `.graph/` 状态**未被手改伪造**：19 个工作流节点的当前状态全部可由事件序列解释，17 个 passed 节点都有完整的 `pending→ready→running(claim)→checkpoint…→execution_report→verdict→passed`，无孤状态、无缺环
- `npm run dep:check` **不是空跑**：注入环后被检出（`cycles:1 / acyclic:false`）
- **未真实发布**（3 路独立佐证：registry 0.3.0 / 无 v0.4.0 tag / `origin/main` 落后 26 个提交）
- **模型白名单未被违反**（16 个会话逐一从 pi session 元数据读出）
- **无过度沙箱宣称**（README ×2、AGENTS、docs/pi-tool-strategy.md 四处明确否定「worktree 隔离＝OS 沙箱」）
- `npm pack` 清单**未泄漏源码**（`src/` 0 条、`test*` 0 条、非 `.d.ts` 的 `.ts` 0 条）
- `docs/deep-research-report.md`（已 gitignore 的历史调研报告）含「完全隔离」「sandbox」等措辞，但它不是交付文档、AGENTS.md 已声明其为历史记录，不计入「文档与实现一致」的判定

## 6. 取证命令清单（可复现）

```bash
# --- 环境与拓扑 ---
node --version; cat package.json; cat tsconfig.json
git status --short; git log --oneline -5; git worktree list; git branch -a; git tag -l
# graph: 用 MCP/CLI 读取
#   graph_validate            -> ok:true, errors:[], 29 节点/39 边
#   graph_get_graph           -> 19 工作流节点状态
#   graph_get_node l5_review  -> 本节点 DoD
#   graph_events last=1000    -> 346 条事件
node "$LOCALAPPDATA/Temp/audit-events.mjs"   # 我写：逐节点 yaml 状态 vs 末条 node_status 事件
node "$LOCALAPPDATA/Temp/audit-seq.mjs"      # 我写：逐节点事件序列完整性（ready/running/report/verdict）

# --- 构建栈 ---
npx tsc --noEmit; echo "EXIT=$?"          # 0
npm run typecheck; echo "EXIT=$?"          # 0
npm run build; find dist -name '*.js' | wc -l ; find dist -name '*.d.ts' | wc -l   # 102 / 102
npm run dep:check                          # modules:102 edges:364 cycles:0 acyclic:true
npm run check; echo "EXIT=$?"              # 0（233/0）
npm test                                   # tests 233 / pass 233 / fail 0
npm run test:e2e                           # tests 24 / pass 24 / fail 0

# --- dep:check 有效性（防空跑）---
TMP=$(mktemp -d); cp -r src "$TMP/src"; cp scripts/check-deps.mjs "$TMP/scripts/"
cd "$TMP"; printf 'import "./b.js";\n' > src/probe/a.ts; printf 'import "./a.js";\n' > src/probe/b.ts
node scripts/check-deps.mjs | tail -3      # cycles: 1 / acyclic: false

# --- 规模与拆分 ---
find src -name '*.js' | wc -l              # 0
find src -name '*.ts' | xargs wc -l | sort -rn | head -3
git ls-tree -r --name-only v0.3.0 -- src | wc -l
git archive v0.3.0 | tar -x -C "$TMP0"; find "$TMP0/src" -name '*.js' | xargs wc -l | sort -rn | head -2

# --- 测试盘点与基线 ---
for f in test/*.test.js test/*.test.mjs; do node --test "$f" | grep -E "tests [0-9]+" | tail -1; done
# v0.3.0 基线：git archive v0.3.0 -> 逐个 node --test
node scripts/verify-publish-workflow.js                     # EXIT=0
RELEASE_TAG=v0.4.0 RELEASE_IS_PRERELEASE=false node scripts/verify-release-metadata.js   # EXIT=0

# --- CLI 冒烟（临时仓库）---
node dist/cli.js --help
node dist/cli.js init && node dist/cli.js status && node dist/cli.js status --json
node dist/cli.js ledger show|verify|recent 5|export out.json
node dist/cli.js status extra-arg        # EXIT=1 [USAGE]
node dist/cli.js status --bogus-flag --json   # EXIT=1, stdout 空, stderr 单个 JSON
node dist/cli.js nope --json            # EXIT=1 USAGE

# --- 发布面 ---
npm pack --dry-run --json > pack.json   # 418 文件：dist 408 / src 0 / test 0 / .d.ts 102
npm publish --dry-run                   # EXIT=0
npm view evofence version               # 0.3.0
git rev-list --count origin/main..main  # 26

# --- 不变式自造篡改（仅临时目录；仓库账本零接触）---
node "$LOCALAPPDATA/Temp/l5review/tamper.mjs"        # 3 事件链：trigger 拒写 / payload / event_hash / 删行
node "$LOCALAPPDATA/Temp/l5review/divergence.mjs"    # status vs run vs loadContract
node "$LOCALAPPDATA/Temp/l5review/divergence2.mjs"   # 同一文件 4 种形态对照
node "$LOCALAPPDATA/Temp/l5review/timeout.mjs"       # evidence run：省略键 TIMEOUT vs 120000 PASS
node "$LOCALAPPDATA/Temp/l5review/nan.mjs"           # run --json 的 stderr 是否被 TimeoutNaNWarning 污染
node "$LOCALAPPDATA/Temp/l5review/report.mjs"        # report <file> --json 的 stdout 形态
node "$LOCALAPPDATA/Temp/l5review/shape.mjs"         # status --json 顶层键 vs StatusView

# --- 未接线/重复实现扫描 ---
node "$LOCALAPPDATA/Temp/l5review/wiring.mjs"        # gate 48 个导出在 src/ 非 gate 处零引用
grep -rn "evaluateBudgetGate\|verdictForEvidence" src/ --include='*.ts' | grep -v "^src/lib/gate/"
grep -rn "from '.*gate/" src/ --include='*.ts' | grep -v "^src/lib/gate/"

# --- 派单审计（独立于台账）---
node "$LOCALAPPDATA/Temp/l5review/sessions.mjs"   # 逐会话 model_change / thinking_level / cwd
node "$LOCALAPPDATA/Temp/l5review/overlap.mjs"    # 会话时间窗重叠峰值 = 4
for c in 235020f 03096f2 a3392fc 31db3cf 248ffc9 588a215; do git log -1 --format='%h %p %an %s' $c; done
git diff 235020f:test/ledger.test.js 03096f2:test/ledger.test.js | head -3   # 空 = 逐字节相同
git diff a3392fc:test/contract-policy.test.js 03096f2:test/contract-policy.test.js | wc -l   # 209 = 两侧不同

# --- 文档与沙箱措辞 ---
grep -rniE "sandbox|沙箱|沙盒" README.md README.en.md AGENTS.md CHANGELOG.md docs/*.md
grep -oE "evofence [a-z]+( [a-z]+)?" README.md | sort -u
git ls-files | grep -i "adr\|context"   # 空 -> ADR 未纳入版本控制（F7）
```

> 我的临时探针脚本都在 `%LOCALAPPDATA%\Temp\` 与 `%LOCALAPPDATA%\Temp\l5review\` 下（bash 下 `/tmp` 即 `%LOCALAPPDATA%\Temp\`）；每个脚本只写自己的临时目录，**未修改仓库内任何文件**（复核结束后 `git status` 与复核前一致，唯一新增文件是本报告）。

## 7. 我认为最重要但无人提及的 Top 3 风险

1. **`tsconfig.json` 的 `allowJs:true` + `checkJs:false` + `src/**/*.js` 把「src 已是 TypeScript」变成一句无门禁的口头承诺**（F4）。所有类型检查、`npm run check` 与 CI 都会对一个放进 `src/` 的 `.js` 完全失明，而它会被正常编进 `dist/` 并随包发布。这一条没有任何节点提及——恰恰因为「`src` 下 `.js` 残留清零」被当作已完成的证据（`l3_integrations` 报告），而清零不代表开关已拆。修复只需删三处，属性价比最高的收口。

2. **两套配置校验器让 `run` 与 `status` 对同一份 `.evofence/` 给出不同结论，且声明的默认值只在一侧 materialize**（F1 + F2）。这不是「未接线」那么简单：`run`——真正执行演化的那条命令——既不拒绝未知字段，也不应用文档与 schema 都声明了的 120000 超时（实测被 1 ms 杀掉 evidence 命令并往 stderr 打 Node 警告）。`l2_config` 如实上报了范围收敛，但验收把它判成「不构成未达标」，文档随即改成全域口径，于是「config v2 fail-closed」这条验收标准只在 `init`/`status` 上为真。派单文档里 `src/lib/config/load.ts` 自己写着「adopting this one is an L3 decision」——这个 L3 决策至今没人拍。

3. **gate 域 6 个 `evaluate*Gate` 与 3 个 `verdict*` 判定入口零生产调用点，而测试锁定的是生产不执行的代码**（F3）。`test/contract-policy.test.js` 的 8 个新用例读起来像「四条门禁的 fail-closed 已被锁定」，实际锁的是并行于生产路径的第二份实现；生产判定（`exec` 内联预算阈值、candidate 检查）只有 `test/runner.test.js` 的 2 个用例看着。叠加 `gate/budget.ts` 与 `exec/budget.ts` 的金额换算原语已签名漂移，这套结构未来必然出现「测试全绿但线上判定变了」或「线上判定正确但测试锁的是另一份」的双向盲区。
