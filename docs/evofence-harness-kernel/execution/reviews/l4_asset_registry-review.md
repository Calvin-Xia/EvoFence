# l4_asset_registry 独立交叉复核（review-1）

日期 / 复核者（pane）：
- 日期：2026-10-02
- 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**；全程只读，唯一写入是本 dossier）

复核对象（commit + 文件/行数 + 用例数）：
- 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，HEAD **`21d6d06eedaa0fd0a4d9a92f45a5ee62fe0aabcc`**（父 `cd7749a`），任务基线 **`6728aae860d4434f8acde554d059a1d344a8bf60`**。
- `src/learning/assets/**`：8 个 TS 模块 / **504** 行（`types 77`、`identity 35`、`registry 56`、`compatibility 62`、`qualification 57`、`decisions 163`、`writer 48`、`index 6`）+ 文档（`README 98`、`EVIDENCE 99`、`EXAMPLE 65`）+ `evidence/**` 原始日志（`results.json`、两份 test-run stdout、static-audit/build/typecheck/src-policy/dep-check stdout，全部 `.stderr.txt` 为 0 字节）。
- `test/l4-assets-*.test.js`：3 文件 / **414** 行 / `node --test` 报 **29**（= 24 条命名行为用例 + 5 条真实变异负控用例）。
- lane 作者工作区（**仅 sha256 比对，未写**）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-assets`，branch `refactor/hk-l4-assets`，HEAD 仍是 `6728aae`，产物 untracked。
- `git show --name-status 21d6d06` = **30 A**（本节点只增不改：`src/learning/assets/**` 27 + `test/l4-assets-*.test.js` 3；`src/{protocol,kernel,runtime}/**` 与既有 L2/L3 模块零改动）。
- 管辖 ADR：`adr_0005`（任务完成/评价/晋升/激活分离）、`adr_0007`（长期能力资产来源与范围）；冻结依据：`INTERFACES.md` `AssetRegistry` 行、`SCHEMAS.md`（`CapabilityAsset`/`AssetRef`/`EvaluationReceipt`/`ActivationReceipt`/`DecisionRecord`）、`OWNERSHIP.md` A05/A11/A13 与 I01–I08。

## 结论：**可接受**（blocker 0 / major 0 / minor 1 / nit 2）

复核简报 §1 列的 9 条断言**逐条独立取证通过**：不可变 revision（内容/来源/兼容/类别/创建时间全部进 digest）与 append-only 历史（替换、撤销均不删旧 revision/旧事件）；状态机 `staged→validated→promoted→active→revoked` 合法转换放行、非法转换与替代 evaluation 被 typed 拒绝，`validated`（eligible=false/usable=false）与 `activated` 分离；host/model/repo/task/scope 兼容条件可验证、`qualification()` 无时钟无 store 读写且同输入逐字相同；撤销/过期沿依赖闭包传播（dependents 全部 invalid/unusable）而历史前缀逐字节保留；越界写（跨项目、绝对路径、`..`、junction 别名、只读 Skill 目标、已存在文件）全部 typed 拒绝且用户 Skills 字节不变；内容身份复用 `kernel/artifacts` + 注入 `DigestPort`，`src/learning/**` 零 `node:crypto`/自算 digest；`src/{protocol,kernel,runtime}/**` 从不 import learning，`static-audit` exit 0 / `violations: []`；四门禁 0、`node --test test/l4-assets-*.test.js` **两次 29/29**；我方自建 7 组探针 + 2 组真实变异负控 0→1→0 复现。1 个 minor 是**证据口径**说明（非缺陷），2 个 nit 是设计边界附注，均不影响本节点验收。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 1 | **m1（证据口径）**：`evidence/results.json`/`EVIDENCE.md` 记录的是 **lane 本地**数字（`src:policy` 216 TS 模块、`dep:check` 216/811、`static-audit` 85 模块/349 边），而集成 HEAD（含 L3 `l3_workspace_txn` 已并入的 `src/workspace/**` + `src/runtime/workspace/**`）实测为 **231 TS 模块 / 896 边 / static-audit 88 模块 / 358 边**。差异完全由 lane 基线 `6728aae` 早于 L3 合入解释（`git show --name-status 21d6d06` 证明 L4 自身只新增 lane 文件），证据未声称是集成口径；复核者在集成环境重跑全部门禁得同一结论（0 violations、29/29 两次）。 |
| nit | 2 | **n1**：`assets` 层**没有显式环检测**，acyclicity 靠两条构造性保证——`stageRevision` 要求依赖“已注册的精确 revision”且 revision 号连续追加，故依赖边恒指向更早注册的 revision；同时 digest 覆盖 `dependencies`，自环是 SHA-256 不动点、构造不出。当前正确，但未来若允许前向引用就必须补显式环检测。**n2**：`qualification()` 对 `staged`/`validated` 会把合成原因 `EFK_ASSET_QUALIFICATION_INVALID` 放进 `reasons`（`validity` 同时为 `unknown`）；消费方不应把它当成资产被证伪，`validity` 字段才是判据。 |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：`git show --name-only 21d6d06` 的 30 个产物文件在 lane ⇔ 集成工作区逐文件比对，**29/29 全等**（唯一差异是集成侧后加的 `docs/.../L4-asset-registry-verify.md`，lane 无此文件）；lane `git status` 显示产物全部 untracked、HEAD 未动。
2. **门禁实测**（集成副本；ADR-0004：测试只吃本次 build 的 `dist/`）：
   - `npm run build` → exit 0；`npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0：`231 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s)`
   - `npm run dep:check` → exit 0：`modules 231 / edges 896 / cycles 0 / acyclic: true`
   - `node --test test/l4-assets-*.test.js` 连跑两次 → 各 `tests 29 / pass 29 / fail 0`
   - `node verification/kernel/static-audit.mjs` → exit 0，`status: "passed"`，`moduleCount 88`，`edgeCount 358`，`"violations": []`
   - 变异实验后再 `npm run build` + 第三次全量跑 → 仍 `29/29`，dist 里 `registry.js`/`identity.js` 的 sha256 与变异前逐字节相同
3. **独立探针 8 组**（自建脚本置于系统临时目录，只 import 集成副本 `dist/**`，fixture 按已冻结合同自行构造，不复用作者 fixture 代码；见 §3）。
4. **变异负控 2 组**（只改本次 build 的 `dist/learning/assets/*.js`，跑红→按备份复原→复绿，并核对 sha256 复原；见 §2）。
5. **全量源码通读**：`src/learning/assets/**` 8 文件 + `README/EVIDENCE/EXAMPLE` + `test/l4-assets-*.test.js` 全文通读；`decisions.ts`/`qualification.ts`/`registry.ts` 的状态机与传播路径逐行核对。
6. **交叉核对**：`evidence/*` 与 `EVIDENCE.md`/`results.json` 逐项对齐（`sourceHashes` 11/11 与当前文件 sha256 相等，`results.json` 自报 tests/negativeControls/commands 与实际一致）；`grep` 核对 `node:crypto`/`learning/` 依赖方向/`node:fs` 归属。

---

## 1. 必须核验的断言逐条判定

| # | 断言 | 判定 | 实测证据 |
|---|---|---|---|
| 1 | 不可变 revision：identity 不可变；历史 append-only（撤销/替换不删旧 revision） | ✅ | 源码：`identity.ts revisionDigest` 把 `candidate` 去掉 `qualification`/`evaluationRef`/`revocationRef`、把 `asset` 去掉 `digest`/`qualificationRef` 后与 `category/compatibility/createdAt` 一起 canonical 后交注入 `DigestPort`；`immutable<T>` 先 JSON 克隆再 `Object.freeze` 深冻结，调用方对象永不被引用或冻结。`registry.ts appendEvent` 只做 `[...snapshot.history, {…, sequence: history.length}]`；`stageRevision` 拒绝同 assetId+revision 的异内容（`EFK_IDEMPOTENCY_COLLISION`）、跳号（`EFK_REVISION_CONFLICT`）、旧 digest 漂移（`EFK_ARTIFACT_DIGEST_MISMATCH`），任何 API 无删除。探针 **P1**（staged 快照不随调用方改写而变、存储 revision `Object.isFrozen`、跳号/碰撞均 typed 拒绝）与 **P4**（撤销后 `revisions` 与 `history` 前缀 `deepEqual` 原值）通过。作者用例 `immutable identity preserves six categories, provenance, time and old revisions`、`duplicate staging is stable; conflicting or skipped revisions cannot rewrite history`、`DoD2 history survives revocation and revision replacement without erasing earlier observations` |
| 2 | 状态机：合法通过、非法 typed 拒绝；`validated ≠ activated` | ✅ | 源码：`decisions.ts recordDecision` 用 `expected = {candidate:'staged', promotion:'validated', activation:'promoted'}` / `outcomes = {validated/promoted/active}` 双重校验，跳过任一阶段即 `EFK_ASSET_QUALIFICATION_INVALID`；promotion 必须复用**已验证的那份** evaluation receipt（`promotion substituted the validated evaluation receipt`），promotion/activation 各自走 `ports.authorize`；activation 还需 `ActivationReceipt.actualStatus==='active'` 且 `newSnapshot!==null`（`EFK_ACTIVATION_UNCONFIRMED`）、session/scope/前序 snapshot 链绑定。探针 **P2**：staged→active（带合法回执）被 `EFK_ASSET_QUALIFICATION_INVALID` 拒；staged→promotion 被拒；`candidate` 决策后 `state/eligible/usable = validated/false/false`，`promotion` 后 `promoted/true/false`，显式 activation 后 `active/true/true`。作者用例 `DoD2 validated never automatically activates; explicit promotion and scoped receipt are required`、`forged issuer, skipped transition and insufficient evaluation cannot grant qualification`、`failed/unknown activation keeps prior history and never invents a new snapshot` |
| 3 | DoD①：兼容条件可验证 + 确定性 `qualification` | ✅ | 源码：`compatibility.ts compatible` 同时校验 host（hostId+version+manifestRef canonical）、model（整个 `ModelRequirement` canonical，含 reasoning payload）、repo（repoId+baseDigest）、taskId、以及 `scopeViolations(c.scope, asset.scope)`；`validateCompatibility` 要求四列表全非空（空兼容=拒绝）。`qualification`/`query` 无时钟、无 store 读取，`reasons` 去重排序；`registry.ts stageRevision` 调 `verifyCompatibilityEvidence` 对 manifest/payload/protocol/workspaceRef 做 `readArtifact` 真实可读性校验。探针 **P3**：两个结构相同但对象不同的 context 返回 `canonical` 相等结果；reasoning payload 变更、manifest 变更分别得 `eligible=false` / `EFK_ASSET_SCOPE_DENIED`；探针 **P6**：`revisionDigest` 必走注入端口，绕过端口的 digest 被 `EFK_ARTIFACT_DIGEST_MISMATCH` 拒。作者用例 `DoD1 compatibility rejects host/model/repository/task/scope drift deterministically`、`qualification is a pure stable view without private evaluation refs or bytes`（该用例把 `artifacts.get` 换成抛错函数后查询仍成功，证明确实不读 store） |
| 4 | DoD②：撤销/过期沿依赖传播、不抹历史；依赖环/缺失依赖明确 | ✅ | 源码：`invalidation` 递归 `asset.dependencies` 收集 `EFK_ASSET_REVOKED`/`EFK_ASSET_EXPIRED`（含 content/source/protocol/host-manifest/model-payload/workspaceRef 的最早 `expiresAt`，以及历史事件 `expiresAt`）；`query` 递归 dependents 汇总 reasons 并要求 `deps.every(eligible)`；撤销只追加一条事件，不写 dependents 的假事件。缺失依赖：`stageRevision` 要求 `findRevision` 命中已注册 revision 否则 `EFK_ASSET_QUALIFICATION_INVALID`，替换 digest/revision 同样拒绝（作者用例覆盖）。环：无显式检测，但依赖必须指向**更早注册**的 revision 且 revision 号连续追加 ⇒ 注册顺序即拓扑序；digest 覆盖 `dependencies` ⇒ 自环是哈希不动点、构造不出（见 n1；探针 P4 证明撤销后新 dependent 被拒、前向引用被拒）。探针 **P4/P5**：root→child 撤销后两者 `eligible=false/usable=false/validity='invalid'/reasons⊇EFK_ASSET_REVOKED` 且 `revisions`/`history` 前缀逐字段不变；过期在 `at=69` eligible、`at=70` `EFK_ASSET_EXPIRED`，且快照 `canonical` 前后相同。作者用例 `DoD2 revocation propagates transitively and preserves every revision and prior event`、`expiry propagates at the exact boundary without mutating history or activating another revision`、`qualification evidence expiry propagates through dependencies without a wall clock or erased history` |
| 5 | 权限边界：用户 Skills 只读；候选限项目授权区 | ✅ | 源码：`writer.ts writeProjectCandidate` 先拒绝对路径、`..`、空段、含 `:` 段；再 `realpath` 解析 project/staging/userSkillRoots 与目标父目录，做**按路径分量**的 `inside` 包含判定（不误判同前缀兄弟目录），并额外拒绝 `userSkillRoots` 与 staging/parent 重叠；用 `open(destination,'wx')` 独占创建 ⇒ 已存在文件/符号链接/硬链接都不被改写（`EFK_IDEMPOTENCY_COLLISION`）；不 mkdir、不发现用户路径。`src/learning/**` 无全局 Skills 目录常量。探针 **P7** 与作者用例：`../escape.md`、`C:/abs.md`、`a/../../escape.md`、staging 越出 project、staging 就是 Skill root、缺失父目录分别得 `EFK_ASSET_SCOPE_DENIED`/`EFK_ARTIFACT_UNAVAILABLE`；junction 别名逃逸与硬链接在真实临时文件系统上被拒，合成用户 `SKILL.md` 字节不变 |
| 6 | 复用不重造：digest/身份语义与 kernel/artifacts 一致，无第二套真相源 | ✅ | `grep -rn "crypto\|createHash" src/learning/` 只命中 `evidence/*` 日志文本，**8 个模块零命中**；`grep` 亦确认 `dist/learning/assets/*.js` 无 `node:crypto`/`createHash`（探针 P6 断言）。digest 一律经 `kernel/store` 的注入 `DigestPort`（`revisionDigest`/`ArtifactStore.put` 同一端口），canonical 复用 `kernel/store/identity.canonical`；产者归属/受众/分区复用 `kernel/artifacts` 的 `attributeProducer`/`verifyForConsumer`（asset 角色按 S18 train-only 判定，`EFK_EVALUATION_PROTOCOL_MISMATCH`/`EFK_PRIVACY_VIOLATION` 直接来自上游矩阵）；wire 形状用 `protocol.decode('CapabilityAsset'/'AssetRef'/'Scope'/…)`，本地类型只是 `Omit<Decoded<…>>` 的 ref 特化，未新增协议。作者用例 `artifact identity and audience are reused, with no unavailable-content fallback` |
| 7 | core 未被污染：`static-audit` 0 violations；learning 不外溢宿主 I/O 到 core | ✅ | `grep -rn "learning/" src/ --include=*.ts \| grep -v "^src/learning/"` → **NONE**（core/protocol/runtime 从不 import learning）；`writer.ts` 的 `node:fs/promises` 只在 learning 层，`dep:check` `cycles 0 / acyclic true`（231 模块）。`static-audit`（只审 `src/{protocol,kernel,runtime}` 的 I01/I02 边与禁用函数）→ exit 0、`violations: []`。`git show --name-status 21d6d06` 证明本节点未改任何 core 文件；`git status --porcelain` 收工时为空 |
| 8 | 门禁 | ✅ | build/typecheck/src:policy/dep:check 全 exit 0（数字见 §0.2）；`node --test test/l4-assets-*.test.js` **两次各 29/29**，TAP 复核 `ok = 29`；`static-audit` 0 violations。证据文件与报告一致：`results.json` 的 `sourceHashes` 11/11 与当前文件 sha256 相等、`tests` 两条 29/29、`negativeControls` 5 条 green/red/restored = `[0,1,1,0]/[1,1,0,1]/[0,1,1,0]`、`commands` 5 条 exit 0；`test-run-1/2.stdout.txt` 各含 29 个 `✔` 与 `pass 29 / fail 0`；全部 `*.stderr.txt` 0 字节 |
| 9 | 负控：≥1–2 个变异 0→1→0 可复现；未证明项如实 | ✅ | 作者自带 5 组 loader 变异随套件执行（green/red/restored + `distUnchanged:true`），我两次全量跑均 29/29（含 5 组）。**我方另做 2 组独立变异**（不同变更点，见 §2）均 0→1→0 且复原后 dist sha256 逐字节一致。未证明项：README/EVIDENCE 如实列出「生产 journal/CAS 接线与持久性、生产 permission-root/lease/safe-idle 强制、真实宿主激活、真实用户 Skills 采样、受控能力收益、Node 22.13 运行、同用户竞态/OS sandbox」——与代码事实一致（`recordDecision`/`stageRevision` 明确是返回不可变下一快照的**纯计划**，`authorize` 由 owning command service 注入；`writeProjectCandidate` 类型注释明写 same-user 非 OS sandbox） |

---

## 2. 变异负控（0 → 1 → 0，仅改 `dist/`，按备份复原）

| 组 | 变异点（编译产物，作者 5 组之外的新点位） | 变红用例（实测） | 复原 |
|---|---|---|---|
| **NC-A** 断言 1/6「immutable revision 的 digest 必须覆盖全部不可变材料」 | `dist/learning/assets/registry.js`：`if (revisionDigest(input, ports.digest) !== c.asset.digest) {` → `if (false) {`（**关闭 digest 一致性校验**） | `--test-name-pattern="identity rejects content, provenance and compatibility digest drift"` → **pass 0 / fail 1 / exit 1**（红）；未变异时同 pattern `pass 1 / fail 0 / exit 0` | `cp` 备份回写；`sha256(registry.js) = ac3642a24eadd22d…879c3343` 与变异前完全相同；复跑同 pattern `pass 1 / fail 0` |
| **NC-B** 断言 1「历史 append-only / 同 revision 不得覆写」 | `dist/learning/assets/registry.js`：`if (previous !== undefined)` → `if (false)`（**关闭同 revision 冲突判定**） | `--test-name-pattern="duplicate staging is stable; conflicting or skipped revisions cannot rewrite history"` → **pass 0 / fail 1 / exit 1**（红）；绿态 `pass 1 / fail 0` | 同上复原；`sha256(registry.js)` 仍 `ac3642a24eadd22d…879c3343`；复绿 `pass 1 / fail 0`；随后 `npm run build` + 全量 `node --test test/l4-assets-*.test.js` → `29/29`，`git status --porcelain` 为空 |

作者自报 5 组（`compatibility-bypass`、`validated-autoactivation`、`revocation-no-propagation`、`outside-write`、`history-erasure`）我通过两次全量跑复现其「套件整体 29/29（含红→复原）」语义，并抽样复核了内嵌 TAP 的红断言文本。

---

## 3. 我方独立探针（8 组，自建脚本于系统临时目录，只 import 集成 `dist/**`）

| 探针 | 结果 |
|---|---|
| **P1** 不可变 revision / append-only 编号 | PASS：调用方改写不回灌；存储 revision 被深冻结（改写抛 `TypeError`）；跳号 `EFK_REVISION_CONFLICT`、同 revision 异内容 `EFK_IDEMPOTENCY_COLLISION`；revision 号只连续追加 |
| **P2** 非法转换 + `validated ≠ activated` | PASS：staged→promotion / staged→active（合法回执）均 `EFK_ASSET_QUALIFICATION_INVALID`；无回执的 activation 决策在 codec 层即 `EFK_SCHEMA_INVALID`；`validated/promoted/active` 三态分别 `eligible/usable = false/false, true/false, true/true` |
| **P3** 确定性 qualification | PASS：两个结构相同但独立构造的 context 返回 `canonical` 相等；reasoning payload、manifest 变更分别 `eligible=false` / `EFK_ASSET_SCOPE_DENIED` |
| **P4** 撤销传播 + 历史保留 + 依赖约束 | PASS：root→child 撤销后两者 `invalid/unusable/reasons⊇EFK_ASSET_REVOKED`；`revisions` 与 `history` 前缀 `deepEqual` 原值；撤销后新 dependent 被拒（ok=false）；同 revision 覆写被拒 |
| **P5** 过期逐边界传播 | PASS：`at=69` eligible、`at=70` `EFK_ASSET_EXPIRED`；查询前后快照 `canonical` 不变 |
| **P6** digest 只走注入端口 | PASS：`revisionDigest` 递增注入端口的 `digest` 调用计数；绕过端口的 digest 被 `EFK_ARTIFACT_DIGEST_MISMATCH` 拒；`dist/learning/assets/*.js` 无 `node:crypto`/`createHash` |
| **P7** 候选写边界 | PASS：`../escape.md`、`C:/abs.md`、`a/../../escape.md`、staging 越出 project、staging 即 Skill root 全部 `EFK_ASSET_SCOPE_DENIED`；缺失父目录 `EFK_ARTIFACT_UNAVAILABLE`（不 mkdir） |
| **P8** 缺失依赖 / 前向引用 | PASS：依赖未注册 revision 的候选被 typed 拒绝；自环因 digest 覆盖 `dependencies` 而无法构造一致引用（朴素自引用版本直接 `EFK_ARTIFACT_DIGEST_MISMATCH`） |

（探针脚本置于 `%TEMP%\l4rev\`，只对系统临时目录做真实文件操作；cwd 保持在集成 worktree；未改 lane、未 commit、未写 `.graph`。）

---

## 4. 未证明项与保留意见（如实）

1. **无持久化真相源（作者已声明，复核确认）**：`stageRevision`/`recordDecision`/`revokeRevision` 是返回不可变下一快照的**纯计划**；生产 journal/CAS 提交、崩溃恢复、跨进程串行由 owning command service 负责，本节点未接线、未证明。
2. **权限与激活为注入/合成**：`RegistryPorts.authorize` 是调用方注入的钩子（探针里为 `storeOk(true)` 或故意 `storeFail`），`ActivationReceipt`/`EvaluationReceipt`/`DecisionRecord`/issuer 注册均为显式 fixture；**真实 permission-root/lease/safe-idle、真实宿主安全点激活未证明**。
3. **真实用户 Skills 未采样**：只读边界用合成临时目录 + 合成 `SKILL.md` 验证（junction/hardlink/traversal 真实文件系统测试），未读取或修改任何真实用户 Skill 目录。
4. **artifact 后端是内存实现**：真实 SHA-256 身份与 S01/S22 校验语义被复用，但**磁盘持久性/并发**未证明。
5. **能力收益未证明**：`l4_capability_trial` 范畴；本节点不声称跨任务收益。
6. **运行环境**：本次证据与我的复跑均在 `Node v24.12.0`；项目最低声明 `Node 22.13` 未在本轮实际执行（作者已列此项）。
7. **无显式环检测（nit n1）**：acyclicity 目前是构造性性质（依赖必须已注册 + digest 覆盖依赖），非运行时算法。
8. **`reasons` 含合成码（nit n2）**：`staged`/`validated` 查询的 `reasons` 会带 `EFK_ASSET_QUALIFICATION_INVALID`，`validity='unknown'` 才是区别判据。
9. **同用户竞态**：`writeProjectCandidate` 是 same-user 边界，类型注释与 README 明示不防同用户并发篡改、非 OS sandbox；`open(...,'wx')` 保证不覆盖但不保证与恶意同用户进程的抗竞态。

---

## 5. 收工一致性

- **lane ↔ 集成 sha256**：`git show --name-only 21d6d06` 的 30 个文件中 29 个全等（第 30 个 `docs/.../L4-asset-registry-verify.md` 是复核简报、lane 无此文件）；lane `git status` 仍全部 untracked、HEAD 未动；集成 `git status --porcelain` 为空。
- **产物 sha256（前 16…后 8）**，lane 与集成本次 build 前逐字节一致：
  - `src/learning/assets/compatibility.ts` `7d717343b0a3168b…be4c8f9e`
  - `src/learning/assets/decisions.ts` `2c07a2a3b608a7d7…53c2da3c`
  - `src/learning/assets/identity.ts` `7206007fef264f57…6cd5756b`
  - `src/learning/assets/index.ts` `f22ab759f6821417…777bf793`
  - `src/learning/assets/qualification.ts` `35240dc60ce5d995…c98015f8`
  - `src/learning/assets/registry.ts` `c1aca4bca0c45038…6f54d002`
  - `src/learning/assets/types.ts` `0b378b6725c306a3…e07e9d69`
  - `src/learning/assets/writer.ts` `ac0c81eb11f8d5e2…b1914625`
  - `test/l4-assets-negative-controls.test.js` `148e59fe7cd84e12…fc981b85`
  - `test/l4-assets-registry.test.js` `07aa47d882e12c87…8c945768`
  - `test/l4-assets-writer.test.js` `f156a87ef3ea50c5…3665c8b6`
  - `src/learning/assets/README.md` `48f9a7e8fceb5ad7…3fdcc401`、`EVIDENCE.md` `9239fe8d36e503d2…850f44c7`、`EXAMPLE.json` `fd1ff604f54b98d5…17df9252`、`evidence/results.json` `d06d5180f9997cd3…0dfe6156`
- **证据↔实况一致**：`results.json.sourceHashes` 11/11 等于当前文件 sha256；`tests` 与 `EVIDENCE.md` 的两轮 29/29、`staticAudit {exit 0, violations 0}`、`dependencies {cycles 0}`、`preservation {trackedDiffExit 0, coreChanged false}` 与我在集成环境重跑结果语义一致（数值差异见 m1，已解释）；全部 `*.stderr.txt` 为空。
- **本次复核的写入**：仅本 dossier `docs/evofence-harness-kernel/execution/reviews/l4_asset_registry-review.md`；未写 `.graph`、未 commit、未改 lane、未改 `src/`/`test/`；变异只落在 `dist/learning/assets/*.js` 且已按备份复原（sha256 逐字节相同），收工前已 `npm run build` + 全量复跑确认。
