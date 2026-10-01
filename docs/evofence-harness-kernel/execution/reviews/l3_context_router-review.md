# l3_context_router 独立交叉复核（review-1）

**日期**：2026-10-02（Asia/Shanghai）
**复核者（pane）**：`verify-router`（`wG:p17`，pi/deepseek-flash，session `01a0f898-dba1-733a-9a06-bace3a9feb02`）——新 pane、未参与本节点写作。
**复核对象**：集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，HEAD = 提交 `1dcf506`（相对集成基线 `8bffca8`）。
**交付面**：`src/learning/context/**` 9 文件（6 `.ts` + `EVIDENCE.md` + `EXAMPLE.json` + `README.md`，共 394 TS 行）+ `test/l3-router-{packet,privacy,stale,negative}.test.js` 4 文件（623 行）/ **37 用例**；`8bffca8..1dcf506` 净增 +1514 行。
**lane 工作区**（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-router`，branch `refactor/hk-l3-router`，HEAD `f74181d`（集成 `8bffca8` 的真实祖先，即 lane 基线；lane `git status` 仅未跟踪 `src/learning/` + 4 个 test 文件）。

## 结论：**可接受**

**blocker 0 · major 0 · minor 0 · nit 4**（nit 见「未证明项与保留意见」，均不改变判定）。

---

## 逐条判定

### ① 复用 kernel/artifacts 受众判定，无第二套真相源 —— 通过

- `src/learning/context/access.ts:1` import `{ partitionFeedback, withheldReason, checkAvailability }`，`:2` import 类型 `ArtifactRef, Audience`；`build.ts:2` import `verifyForConsumer`；均来自 `../../kernel/artifacts/index.js`。
- `audienceForRole` 只做 role→`Audience` 枚举别名（executor/fresh-verifier→`author`，private-evaluator→`evaluator`，learner→`asset-staging`），未声明角色走 `default` 拒绝。
- 对 `src/learning/context/*.ts` grep `public|internal|private|held-out|final|rank|RANK|ceiling|CEILING`：**只有** role 别名与注释，**无** visibility rank/ceiling/partition 许可表（复刻 L2 `access.ts` 的两轴判定完全留在 kernel）。
- **独立反证（我的 loader，非作者套件）**：在子进程内把 **kernel** `dist/kernel/artifacts/access.js` 的 `AUDIENCE_CEILING.author: 'internal'` 改为 `'final'`，`node --test --test-name-pattern='private and final refs never reach' test/l3-router-privacy.test.js` → **exit 1 / ERR_ASSERTION**；移除 loader → exit 0。若 router 有自建平行表，改 kernel 不会变红 → 证明受众判定确为单一真相源（`/tmp/l3-review-negative.mjs`，3/3）。
- 隐私投影 `projectTask` 用 `withheldReason` 决定每个内嵌 `ArtifactRef` 的去留，`partitionFeedback(inputs.plan.inputRefs, audience)` 决定计划输入的可见集；二者都是 kernel 判定。

### ② 决定性：同输入 packet 逐字节相同 —— 通过

- `src/` 无 `Date`/`Math.random`/`process.env`/`fs`/`network`（grep 确认）；时间经 `inputs.at` 注入。
- **自建探针（作者套件之外，`/tmp/l3-review-probe.mjs`）A1**：同输入两次调用、**另建 router 实例**调用、以及把 `TaskContract` 顶层键序反转后调用，三次 `serialized` **逐字节相同**（7089 bytes / 7089 tokens），且 `tokenCount === tokenizer.countTokens(serialized)`；调用不修改调用方数据。
- **A6**：同一输入间隔 25ms 两次构建，`serialized` 与 `tokenCount` 完全一致（无墙钟/环境依赖）。
- 序列化用 `kernel/store/identity.canonical`（键排序、数组保序、无空白）；`projectTask` 对对象键显式排序。

### ③ token 上限真实：超限拒绝/裁剪，不静默丢证据 —— 通过

- `window.ts:fitWindow` 先量**完整 canonical serialized**（task+正文+条目+audit+withheld 计数），`tokenCount <= tokenLimit` 才返回；`compact` 时对 evidence/handoff 正文按 `excerptChars→64→32→…→0` 逐档裁剪并**每次重测**，human/host instructions 不裁剪，放不下则 `EFK_BUDGET_EXHAUSTED`（不删引用换成功）。
- `build.ts` 的 `tokenLimit = min(maxInputTokens−hostInputTokens, plan.maxTokens, windowTokens−reservedOutputTokens−hostInputTokens)`；`reservedOutputTokens > maxOutputTokens` 或 `tokenLimit<=0` 亦拒绝。无任何默认值。
- **探针 A2 实测**：`reject` 策略下 `full=7079`，`maxTokens=7079` 接受（`compressed=false`），`7078` → `EFK_BUDGET_EXHAUSTED`；`compact`+`excerptChars=0`+40,000 字节正文，**不可压缩下限 `floor=7077`**，`maxTokens=7077` 接受（全部 `mode=reference`），`7076` → `EFK_BUDGET_EXHAUSTED`；40,000 字节正文在 9000 限下压缩到 `7173/9000`，`entries=2`、`audit=4` 一个不丢。
- 作者套件 `token gate is inclusive at the measured boundary…`、`unfit mandatory task/references refuse…`、`zero-character summary still carries full evidence references and audit…` 均绿。

### ④ 压缩保留引用（id+digest+可见性），非仅摘要 —— 通过

- 压缩只改 `entry.text` 与 `entry.mode`，`entry.ref`（`EvidenceLink`：id/digest/visibility/partition/schema/binding/producer.kind+actorId/expiresAt）与 audit 原样保留。
- **探针 A3**：40,000 字节双工件压缩为 `7350/12000`，逐条核对 `id/digest/visibility/binding.attemptId/producer.actorId` 与输入一致、audit reason 对齐；把 `serialized` **重新 parse** 后仍能还原 `[[proof-1,sha256:3036…],[handoff-1,sha256:4341…]]` 与 4 条 audit。
- **`EXAMPLE.json` 独立复算**：`tokenCount=7350`，对 `serialized` 重新逐字节计数 = **7350**（一致）；`tokenLimit=12000`，`compressed=true`，`tokenizerId=fixture:utf8-byte/v1`，`withheld={visibility:1,partition:0}`，`serialized` 等于 `packet` 的 canonical 串。`proof-1` digest `sha256:30360c8398…` = sha256(`'证据🙂'×10000`)，`handoff-1` digest `sha256:43416c6bbe…` = sha256(`'trace '×10000`)，与 `EVIDENCE.md` 表一致。

### ⑤ DoD② 隐私：私有数据对 executor/learner 不可见，无影子通道 —— 通过

- 受众矩阵 4 role × 5 visibility × 5 partition = 100 组合（`privacy.test.js`「role/visibility/partition matrix agrees with the one kernel artifact authority」）。
- **探针 A4**（独立于作者套件）：held-out/final/private 三类隐藏工件对 `executor`/`fresh-verifier`/`learner` 全部 withheld（`withheld={visibility:1,partition:2}`），packet 输出中不含其 `id`/`digest`/`location`/`bytes` 任一 marker；`private-evaluator` 看到全部 4 条且 `withheld={0,0}`；`candidate-feedback` 即使标 `visibility:'public'` 也仅 evaluator 可路由（`EFK_PRIVACY_VIOLATION`），拒绝回包 `JSON.stringify` 不含该私有 id、`refs=[]`。
- **影子通道反例（A4 + 作者套件）**：把隐藏工件的 `bytes`/`id`/`digest`/`location`/`producer.actorId`/`schema.digest` 全部改掉，`serialized` **逐字节不变**（隐藏字节不进 `put`/`get`/digest/tokenizer）；嵌套 `producer.identityRef` 不搭车（`EvidenceLink` 不含 `location`、不含 nested identityRef）；完整合同 digest `sha256(canonical(TaskContract))` 不出现在输出中（作者套件断言）。无日志通道（`src/learning/context` 无 `console.*`/`process.*`/I/O）。

### ⑥ 未知角色/未声明可见性/越枚举 fail-closed —— 通过

- **探针 A5**：角色 `'admin'`/`'orchestrator'`/`''`/`undefined`/`null`/`'__proto__'`/`'Executor'` 逐一 → `EFK_SCHEMA_INVALID`（typed，非默认可见）；输入 ref 的未知 `visibility`/`partition` 枚举、未知 `purpose` 亦 → `EFK_SCHEMA_INVALID`，**不回显**非法枚举串；私有 TaskContract 对 executor → `EFK_PRIVACY_VIOLATION`。
- `safeFailure` 把 codec 失败的 message 收敛为固定串 `'context input rejected'`（防非法枚举串夹带私有数据）；该点在探针与作者套件均实测。
- 其余 fail-closed：未声明/替换/重复输入 → `EFK_GRAPH_INPUT_STALE`；缺 bytes → `EFK_ARTIFACT_UNAVAILABLE`；summary 代替 bytes → `EFK_SCHEMA_INVALID`；绑定/图/base/epoch 漂移 → `EFK_ARTIFACT_BINDING_MISMATCH`；合同 pin 漂移 → `EFK_SOURCE_PIN_DRIFT`；`fresh-verifier` 非 fresh transcript → `EFK_PRIVACY_VIOLATION`。

### ⑦ 门禁与边界 —— 通过

cwd = 集成 worktree，全部命令对**本次 build** 的 `dist/`：

| 命令 | exit | 实测 |
|---|---:|---|
| `npm run build` | 0 | tsc 成功，重新生成 `dist/**` |
| `npm run typecheck` | 0 | 0 errors |
| `npm run src:policy` | 0 | 197 TS 文件；最大 350 行（`src/lib/pi-tool-strategy.ts`）；0 JS；6 个 context 文件最长 95 行 |
| `npm run dep:check` | 0 | modules=197；edges=733；cycles=0；acyclic=true |
| `node --test test/l3-router-*.test.js`（第 1 次） | 0 | tests=37；pass=37；fail=0；skip=0 |
| 同命令（第 2 次） | 0 | tests=37；pass=37；fail=0；skip=0 |
| `node verification/kernel/static-audit.mjs` | 0 | status=passed；moduleCount=79；edgeCount=318；violations=**0**；parser=typescript6 6.0.3 |
| `git diff --exit-code -- src/protocol src/kernel src/runtime` | 0 | core 未被本节点污染（相对 HEAD 与相对 `8bffca8` 均空） |

- 无 `src/protocol|kernel|runtime` import `src/learning/context`（grep 全仓只有 4 个 test 文件与 `learning/context` 自身引用它）。
- 负控真实且非镜像：作者 3 条（token-gate / evidence-loss / private-leak）实测 mutated exit=1、`# fail 1`、`ERR_ASSERTION`，restored exit=0、`# pass 1`；loader 断言 `split(from).length===2` 防「变异点漂移」静默变绿，且要求 `ERR_ASSERTION` 排除导入失败的伪红。**我另以自建 loader 独立复现 3 条**（含一条作者未做的 kernel-ceiling 变异），3/3 均真红真绿。
- 所有变异均为子进程内 ESM loader 内存改码，不写 source/dist/core；变异后 `git status` 干净，磁盘 `dist` 复跑仍 24/24 绿。

### ⑧ 证据诚实 —— 通过

- `src/learning/context/EVIDENCE.md` 的未证明项如实：真实宿主（Pi/DSH）tokenizer/窗口封套与 retained resources 计数、native fresh transcript 与 evaluator 角色授权接线、workspace/evaluation 编排与真实长程收益、任意未标记正文中的 secret 检测——均明列「未证明」，并声明 fixture 是「确切 byte-tokenizer 的门禁证明，不是实际模型 token 消耗或收益声明」。
- 门禁数字（197/350/0、197/733/0、37/37、79/318/0 violations）与 `EXAMPLE.json` 的 7350/12000/`{1,0}` 全部独立复算一致。
- 负控是**真变异**（改真实实现字节、要求行为断言变红），非镜像实现的重述测试。
- `EVIDENCE.md` 记录的 lane base `f74181d7` 与简报的集成基线 `8bffca8` 不同但自洽：`f74181d7` 是 lane 的实际 HEAD 且 `git merge-base --is-ancestor f74181d7 8bffca8` 为真，非口径造假。

---

## sha256 比对（lane ↔ 集成 HEAD，13/13 MATCH）

以 `sha256sum "$LANE/<f>"` 对 `git cat-file blob HEAD:<f>`：

| 文件 | sha256 |
|---|---|
| `src/learning/context/access.ts` | `d790e291c68318d413df0b9be862eb8c04cb22354e0ac58333003d153d24779a` |
| `src/learning/context/build.ts` | `705479c4d097bd735a6878d82a037c17359fe6f1b12d7cec771a820a5c7cb21c` |
| `src/learning/context/index.ts` | `58889adbf4491dc2c8883c6876e74cda8fd7375fce4252cb50e1be1d3bab6d99` |
| `src/learning/context/types.ts` | `182fda99d77b39bd73761f985b91596f032ebc7558b16d7d5ac9497099e88635` |
| `src/learning/context/validate.ts` | `728a435b6fbda509b8335e7d370deec321e883478c8b741aaae640913bbc3951` |
| `src/learning/context/window.ts` | `a52c7e7f07cace7ba6a0e124325504d627cbf610b26f064bb68ce59c4bc06d81` |
| `src/learning/context/EVIDENCE.md` | `d1695134e5c04d0266b2ac480a44d7e3c8be94373b419b4b5baf439fbf46838e` |
| `src/learning/context/EXAMPLE.json` | `aed387e428785872c71da2811d492e96ebba0d0abd118cb6bbea84b15954963a` |
| `src/learning/context/README.md` | `917480c8227ff7dff8894c9935da0dbd3131c8136fa92e9d8e3f1d1b29fcd019` |
| `test/l3-router-negative.test.js` | `f985532f4b4f006b93b119e9fab1ed999b846dbe532e5f9fed52bf9e12eabc75` |
| `test/l3-router-packet.test.js` | `17519fed45d4ae44ada30fc7d69c9898719a055284c12b6fd5586130c573d5eb` |
| `test/l3-router-privacy.test.js` | `9f2da390c181be08aafbb8f6d745b6a793d756e24efad1b25cf55035663c7024` |
| `test/l3-router-stale.test.js` | `0833dadf0b61257c1b3fdc3c6a84787b627942b0fd83a6d44154c4c782febd69` |

## 独立探针与负控结果

- 自建探针（`/tmp/l3-review-probe.mjs`，只 import 本次 build 的 `dist/learning/context/index.js` 与共享 L2 fixture）：**6/6 通过**（A1 决定性、A2 上限、A3 引用保留、A4 隐私、A5 fail-closed、A6 无环境依赖）。首轮误报均为探针自身缺陷（JS 默认参数吞掉 `undefined` 角色、限值取在不可压缩下限之下、audit 计数按 2 记而非 2+2），修正探针后全绿；产品行为未改。
- 自建负控（`/tmp/l3-review-negative.mjs`，独立 loader）：kernel-ceiling 变异 / router token-gate 变异 / evidence-loss 变异 = **3/3 真红真绿**，均 `ERR_ASSERTION`。

---

## 未证明项与保留意见

以下为 nit（记录性，不阻断）：

1. **`projectTask` 的 `location` 启发式**：以「解码后的 TaskContract 闭包内只有 `ArtifactRef` 有 `location` 字段」识别内嵌引用。已核验该前提当前成立（`src/protocol/objects/*.ts` 中 `location` 仅出现在 `ArtifactRef`（`evaluation.ts:21/26`），且 codec 拒绝额外属性——`f.contract.unknown=true` → `EFK_SCHEMA_INVALID`）。若冻结合同闭包未来新增带 `location` 的对象，此处需同步；建议作为不变式留档。
2. **withheld 计数是一个粗粒度旁路**：`{visibility,partition}` 计数会让受限角色得知「存在 N 个不可见引用」，但按 L2/A13 设计不含 id/digest/locator/producer，非私有身份泄露；`README.md` 已明述。
3. **`strategy:'reject'` 不走压缩**：因此 `reject` 的「下限」就是完整 packet，而非 reference-only 下限；这是预期语义（拒绝优先），非缺陷。
4. **`audienceForRole` 未直接 import `isRestrictedPartition`**：partition 判定经 `withheldReason`/`partitionFeedback` 间接复用同一 kernel 判定，无平行表——仅记录，无需动作。

**如实转述的未证明项（与本节点交付一致）**：真实宿主 tokenizer/window 封套与 retained resources 计数、native fresh transcript 与 evaluator 角色授权接线、`l3_workspace_txn`/`l3_task_evaluation` 编排与真实长程收益、任意未标记正文中的 secret 检测——本 lane 均**未**证明；上游若把私有内容伪装成正确声明的 public artifact，需由 provenance/privacy pipeline 拒绝，router 本身无法仅凭字符串发现。

---

## 收工一致性

- **写入**：仅本 dossier `docs/evofence-harness-kernel/execution/reviews/l3_context_router-review.md`。`git status --porcelain` 另见预先存在的未跟踪 `docs/evofence-harness-kernel/execution/tasks/L3-context-router-verify.md`（复核简报，非本次产生）。未写 `.graph`、未 commit、未改 lane、未改 core。
- **测试/审计数字**：`npm run build|typecheck|src:policy|dep:check` = 0/0/0/0；`node --test test/l3-router-*.test.js` 两次均 **37/37**；`static-audit` = passed/0 violations；自建探针 6/6；自建负控 3/3；lane↔集成 13/13 sha256 MATCH；`EXAMPLE.json` 复算 7350/12000/`{1,0}` 一致。
