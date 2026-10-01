# l4_retrieval 独立交叉复核（review-1）

日期 / 复核者（pane）：
- 日期：2026-10-02
- 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**；全程只读，唯一写入是本 dossier）

复核对象（commit + 文件/行数 + 用例数）：
- 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，复核目标 **`8cef8ff`**（父 = 基线 **`d2e311d`**）；当时 HEAD **`d807591`**，其后仅追加复核简报 `docs/.../L4-retrieval-verify.md`（`git diff --name-status 8cef8ff HEAD -- src/learning/retrieval test/l4-retrieval-*.test.js` 为空，故 HEAD 的 5 个测试文件与 `src/learning/retrieval/**` 与 `8cef8ff` 逐字节相同）。
- `src/learning/retrieval/**`：5 个 TS 模块 / **255** 行（`types 77`、`retrieve 120`、`material 33`、`feedback 22`、`index 3`）+ 文档（`README`、`EVIDENCE`）+ `evidence/**` 原始日志/样例（`results.json`、`negative-controls.json`、`example.json`、`empty-example.json`、两份 test-run stdout、static-audit/build/typecheck/src-policy/dep-check stdout，全部 `.stderr.txt` 为 0 字节）。
- `test/l4-retrieval-*.test.js`：5 文件 / **550** 行；`node --test` 报 **32**（= 31 条命名行为用例 + fixtures 辅助文件的 1 条 file-discovery 用例）。用例分布：selection 8 / context 8 / rejection 11 / negative-controls 4（循环生成）/ fixtures 0。
- lane 作者工作区（**仅 sha256 比对，未写**）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l4-retrieval`，branch `refactor/hk-l4-retrieval`，HEAD 仍是 `d2e311d`，产物全部 untracked。
- `git show --name-status 8cef8ff` = **30 A**（只增不改：`src/learning/retrieval/**` 25 + `test/l4-retrieval-*.test.js` 5；`src/{protocol,kernel,runtime}/**` 与既有 L2/L3 模块零改动，无 M/D）。
- 管辖 ADR：`adr_0005`（完成/评价/晋升/激活分离）、`adr_0007`（长期能力资产来源与范围）。

## 结论：**可接受**（blocker 0 / major 0 / minor 1 / nit 2）

复核简报 §1 的 8 条断言**逐条独立取证通过**：资格筛选确实复用 `src/learning/assets` 的 `qualification`/`sameRevision` 与 `kernel/artifacts` 的 `verifyForConsumer`，检索层**零第二套信任判定**；候选排序同输入逐字节相同、乱序输入亦相同，revision 作为显式 tie-breaker；token/数量预算边界真实生效、tokenizer 经 `RetrievalPorts.tokenizer` 注入（无硬编码）；DoD① 六类污染（scope 不符 / 来源不明 / 失效 / 未验证 / 撤销 / held-out）全部 typed 拒绝且 `materialReads=0`、不入 candidate；DoD② 空集返回精确 base 执行（`no-eligible-assets`）且开销如实记录（tokenizer 调用数/累计 token 非零，wall/usd 为 `null` 而非 0）；cp2 归因 `retrieved/used/ignored` 可追溯到 asset identity，packet 复用 `BoundedContextPacket`（无第二套）；四门禁 0、`node --test` 两次 32/32、`static-audit` exit 0 / `violations: []`、提交只增不改；我方另做 2 组独立变异 0→1→0 复现。1 个 minor 是**证据完整性**（`results.json` 缺 `sourceHashes`，非缺陷），2 个 nit 是设计/口径附注，均不影响验收。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 1 | **m1（证据完整性）**：与 `l4_asset_registry` 不同，本节点 `evidence/results.json` **没有 `sourceHashes` 字段**（键仅为 `evidenceLevel/branch/baseline/results/repeatedTestsIdentical/negativeControlsIdentical`），故简报 §1 断言 8 的「`sourceHashes` 与实际一致」无法从证据内核对。复核者以**实时 sha256** 替代：lane ⇔ 集成 10/10 文件逐字节相等（见 §5）。属证据完整性缺口，非行为缺陷。 |
| nit | 2 | **n1（拒绝层口径）**：把检索 `context.scope` 放宽到超出 taskContract scope 时，先被绑定校验拦成 `EFK_ARTIFACT_BINDING_MISMATCH`；只有「任务契约与资产兼容 scope」不符才走资产兼容路径给 `EFK_ASSET_SCOPE_DENIED`。两级都是 typed 拒绝、都不注入，但消费方需按错码来源区分，勿只认 `EFK_ASSET_SCOPE_DENIED`。**n2（开销口径）**：`RetrievalCost.wallMs`/`usdMicros` 恒为 `null`，由调用方在 experiment envelope 里测价；「检索开销纳入对照」目前只覆盖 token/计算计数（tokenizer 调用、tokensCounted、materialReads），不含真实 wall/发票成本（EVIDENCE 已如实声明）。 |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：复核目标 10 个产物文件（5 TS + 5 test）在 lane ⇔ 集成工作区逐文件比对，**10/10 全等**；lane `git status` 显示产物全部 untracked、HEAD 未动；集成 `git status --porcelain` 为空。
2. **门禁实测**（集成副本；ADR-0004：测试只吃本次 build 的 `dist/`）：
   - `npm run build` → exit 0；`npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0：`236 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s)`
   - `npm run dep:check` → exit 0：`modules 236 / edges 917 / cycles 0 / acyclic: true`
   - `node --test --test-reporter=tap test/l4-retrieval-*.test.js` 连跑两次 → 各 `tests 32 / pass 32 / fail 0 / skipped 0 / cancelled 0`
   - `node verification/kernel/static-audit.mjs` → exit 0，`status: "passed"`，`moduleCount 88`，`edgeCount 358`，`"violations": []`
   - 变异实验后 `dist/learning/retrieval/retrieve.js` sha256 与变异前逐字节相同（只经 ESM loader 在内存改，不落盘）
3. **独立探针 1 组（16 项断言）**：自建脚本置于系统临时目录，只 import 集成 `dist/**`，复用本测试套件的 fixture（其 registry 写入走真实路径）；见 §3。
4. **独立变异负控 2 组**（点位不同于作者 4 组；只改内存中的 `dist/learning/retrieval/retrieve.js`，跑红→复原→复绿，核对 sha256）；见 §2。
5. **全量源码通读**：`src/learning/retrieval/**` 5 文件 + `README/EVIDENCE` + `test/l4-retrieval-*.test.js` 全文通读；`retrieve.ts` 的门禁/预算/排序/归因路径逐行核对，`material.ts`/`feedback.ts` 逐行核对。
6. **交叉核对**：`evidence/*` 与 `EVIDENCE.md`/`results.json` 逐项对齐（两轮 32/32、static-audit 88/358/0、`negativeControls` 4 条 green/red/restored = `[0,1,1,0]/[1,1,0,1]/[0,1,1,0]`、`distUnchanged:true`、全部 `*.stderr.txt` 0 字节、两次 test-run 行为输出 diff 为空）；`grep` 核对无第二套资格判定、无本地 packet 定义、import 方向；`git show --name-status 8cef8ff` 证明只增不改。

---

## 1. 必须核验的断言逐条判定

| # | 断言 | 判定 | 实测证据 |
|---|---|---|---|
| 1 | 资格筛选**复用** `src/learning/assets` 的 qualification/状态/依赖传播（无第二套信任判定） | ✅ | `retrieve.ts` 只 `import { qualification, sameRevision } from '../assets/index.js'`，对每个候选调 `qualification(input.registry, ref, c)` 并只消费 `q.value.eligible`；状态/撤销/过期/依赖闭包传播全部来自上游 `assets/qualification.ts`（`invalidation` 递归 `dependencies`）。`material.ts` 复用 `kernel/artifacts` 的 `verifyForConsumer`（受众/来源矩阵）、`kernel/store` 的 `canonical`。`grep -rniE "eligible|revoked|expired|unvalidated|held.?out" src/learning/retrieval/*.ts` 除调用点外**无任何本地判定分支/平行表**。 |
| 2 | 确定性：同输入 candidate 逐字节相同；排名稳定 + 显式 tie-breaker（revision 等） | ✅ | 源码：候选先按 `canonical(a)` 字典序（`lexical`）稳定排序，再按 `contentTokens → assetId → revision 降序 → digest` 排序。探针 P1：`repeatIdentical=true`、`inputUnchanged=true`、乱序 `candidates/materials/nodeInputRefs/taskContract` 后 `permutedIdentical=true`，排名 `[cheap, alpha, zeta]`；探针 P2：同内容 revision 1/2 只取 `revision=2`（无 latest 查询，靠显式传入）。作者用例 `cp1 ranking is byte-identical…`、`cp1 equal-cost revisions…`。**独立变异 NC-B**（删 tie-breaker）→ 该用例红。 |
| 3 | 预算裁剪：token/数量上限真实生效；开销可复算；tokenizer/计数器**注入**而非硬编码 | ✅ | 源码：`maxAssets` 限 `0..5`、`maxAddedTokens≥0`；`maxAssets` 达上限裁 `asset-count-budget`；试拼 packet 超 `maxAddedTokens` 裁 `added-token-budget`；`buildContextPacket` 超窗裁 `context-window-budget`。tokenizer 经 `RetrievalPorts.tokenizer` 注入，`RetrievalCost.basis='injected-tokenizer-estimate'`、`tokenizerId` 原样回填；非整数/负 token 数被 `EFK_SCHEMA_INVALID` 拒。探针 P3：`maxAddedTokens = chargedAddedTokens` → candidate（含边界），`-1` → base 且每条 `added-token-budget`；`maxAssets=0` → base。**独立变异 NC-A**（关闭 token 预算判定）→ `cp1 complete-packet token boundary…` 红。作者用例 `cp1 complete-packet token boundary…`、`cp1 clipping skips an unfit asset…`、`cp2 a non-monotonic tokenizer retains the signed delta…`。 |
| 4 | DoD①：scope 不符/来源不明/失效/未验证/撤销/held-out 污染全部 typed 拒绝、不进 candidate | ✅ | 逐类实测（探针 P5 + 作者用例）：<br>· 撤销 → `EFK_ASSET_REVOKED`（root→child 闭包，mode=base，`materialReads=0`）<br>· 失效/过期 → `EFK_ASSET_EXPIRED`（`at=30` 边界被拒，`at=29` 通过）<br>· 未验证（staged/validated）→ `EFK_ASSET_QUALIFICATION_INVALID`，`retrieved=false`<br>· scope 不符 → 绑定级 `EFK_ARTIFACT_BINDING_MISMATCH` 或资产兼容级 `EFK_ASSET_SCOPE_DENIED`<br>· 来源不明 → 注册期 `EFK_ARTIFACT_BINDING_MISMATCH`；被拒候选进检索 → `EFK_ASSET_QUALIFICATION_INVALID`、`materialReads=0`<br>· held-out（source/content）→ 注册期 `EFK_EVALUATION_PROTOCOL_MISMATCH`；伪造指令标签 → `EFK_AUTHORITY_DENIED`<br>另有未声明/替换/不可用 hydration、重复 hydration、base plan 预载未资格资产等全部 typed。 |
| 5 | DoD②：空集 → 明确基础执行回退（不是错误、不是空注入）；开销记录在案 | ✅ | 探针 P4：空 registry → `mode='base'`、`candidate=null`、`fallbackReason='no-eligible-assets'`、`context` 与 `baseline()` `deepEqual`；`tokenizerCalls=1`、`tokensCounted=4088>0`、`inputTokenDelta=0`、`chargedAddedTokens=0`、`modelRequests=0`、`wallMs=null`、`usdMicros=null`。有候选但全被裁 → `no-assets-fit`。`evidence/empty-example.json` 与实际一致（base / 4088 / 1 call / 0 delta）。作者用例 `DoD2 empty registry…`、`cp3 disabled or zero-token injection budgets…`。 |
| 6 | cp2 归因：retrieved/used/ignored（含理由）可追溯到 asset/revision；与 `l3_context_router` packet 形态一致（无第二套 packet） | ✅ | 源码/探针 P6：`ActivationContextCandidate.context` = `BoundedContextPacket`（直接从 `src/learning/context` 的 `buildContextPacket` 产出），`candidate.context === result.context`、`context.serialized === canonical(context.packet)`、`packet.audit.at(-1).source === 'ContextPlan.inputRefs'`、`packet.binding.nodeId='retrieval-node'`；`grep` 确认 `src/learning/retrieval/*.ts` **未定义任何 `*Packet` 类型**。归因记录含 `asset{assetId,revision,digest}`、`qualification`、`retrieved`、`disposition`、`reasons`、`contentTokens`、`entryIds`；`feedback.recordUsage` 仅对已选中资产接受 `used/ignored` + 非空 `reason`，按 `canonical(asset)` 追溯，拒绝缺失/重复/未选中/无理由/非法处置。作者用例 `cp2 candidate reuses bounded context packet…`、`cp2 usage feedback…`、`cp2 feedback refuses missing…`。 |
| 7 | 门禁与边界 | ✅ | build/typecheck/src:policy/dep:check = 0；`node --test test/l4-retrieval-*.test.js` **两次 32/32**；`static-audit` exit 0、`violations: []`（88 模块/358 边）；`git show --name-status 8cef8ff` = 30 A（只增不改，core/上游零改动）。行数：最大 TS 文件 `retrieve.ts` 120 行 < 350。 |
| 8 | 证据与负控 | ⚠️ 部分（minor m1） | `results.json` 的 tests/negativeControls/命令 exit 与实况一致、两次 test-run 行为输出 diff 为空、全部 `*.stderr.txt` 0 字节；**但缺 `sourceHashes` 字段**（m1），已用实时 sha256 lane⇔集成 10/10 替代核对。变异：作者 4 组随套件两次全绿通过；**我方独立 2 组 0→1→0**（§2）。未证明项如实（§4）。 |

---

## 2. 变异负控（0 → 1 → 0，仅内存改 `dist/`，不落盘）

作者自带的 4 组 loader 变异（`qualification-bypass`、`revocation-bypass`、`empty-injection`、`unaccounted-overhead`）随套件执行，两次全量跑均 32/32（含红→复原语义），内嵌 TAP 红断言文本与 `negative-controls.json`/`results.json` 一致。我方另做 **2 组独立变异**（点位不在作者 4 组内）：

| 组 | 变异点（编译产物 `dist/learning/retrieval/retrieve.js`，内存） | 变红用例（实测） | 复原 |
|---|---|---|---|
| **NC-A** 断言 3「token 上限必须真实裁剪」 | `else if (Math.max(0, candidate.value.tokenCount - baseline.value.tokenCount) > b.maxAddedTokens)` → `else if (false)`（**关闭 token 预算判定**） | `--test-name-pattern="cp1 complete-packet token boundary"` → `name:'AssertionError'`，`pass 0 / fail 1`；未变异同 pattern `pass 1 / fail 0` | 仅内存替换、不落盘；复原后同 pattern `pass 1` |
| **NC-B** 断言 2「等代价需显式 tie-breaker」 | `\|\| b.record.asset.revision - a.record.asset.revision \|\|` → `\|\| 0 \|\|`（**抹掉 revision tie-breaker**） | `--test-name-pattern="cp1 equal-cost revisions"` → `name:'AssertionError'`，`pass 0 / fail 1`；绿态 `pass 1 / fail 0` | 同上；复原后 `pass 1` |

两组均确认红是 **AssertionError**（非 loader/进程崩溃），变异前后 `sha256(dist/learning/retrieval/retrieve.js)=1f2bdee4…fce69d2` 逐字节不变。（首轮我用 `file:///tmp/…` 直接调 loader，在 Windows 上触发 `ERR_INVALID_FILE_URL_PATH` 造成一次假红；改用 `pathToFileURL`/原生绝对路径后重跑，上述结果才是真实语义。）

---

## 3. 我方独立探针（1 组 / 16 项，脚本于系统临时目录，只 import 集成 `dist/**`）

| 项 | 结果 |
|---|---|
| P1 确定性 + 乱序 + 输入不变 + 裁剪归因 | PASS：`repeatIdentical/permutedIdentical/inputUnchanged` 全 true，排名 `[cheap,alpha,zeta]`，`expensive → ['asset-count-budget']` |
| P2 等代价 tie-breaker | PASS：取 `revision=2` |
| P3 token 预算边界 + tokenizer 注入 | PASS：`atBoundary='candidate'`、`belowBoundary='base'`（全 `added-token-budget`）；注入 tokenizer `id` 回填、调用数一致、`basis='injected-tokenizer-estimate'` |
| P4 空集回退 + 开销 | PASS：`base/no-eligible-assets/candidate=null`，`tokenizerCalls=1`、`tokensCounted>0`、`delta=0`、`context==baseline`、`wall/usd=null`；有候选全裁 `no-assets-fit` |
| P5 DoD① 六类 typed 拒绝 | PASS：scope→`EFK_ARTIFACT_BINDING_MISMATCH`、unknown-source 注册→`EFK_ARTIFACT_BINDING_MISMATCH`、held-out source/content 注册→`EFK_EVALUATION_PROTOCOL_MISMATCH`、revoked→`EFK_ASSET_REVOKED`、expired→`EFK_ASSET_EXPIRED`、staged→`EFK_ASSET_QUALIFICATION_INVALID`、伪指令 purpose→`EFK_AUTHORITY_DENIED` |
| P6 packet 复用 | PASS：`packetSameObject=true`、`serialized==canonical(packet)`、`audit.source='ContextPlan.inputRefs'`、packet 键 `{audit,binding,entries,isolation,preserveHostResources,role,task,withheld}`（context router 同款） |

---

## 4. 未证明项与保留意见（如实）

1. **真实收益未证明**：`l4_capability_trial` 范畴；本节点只证明「确定性、资格一致、预算/归因真实」，不声称跨任务能力提升。EVIDENCE/README 已声明。
2. **provider/真实 tokenizer 与真实成本未证明**：`RetrievalCost` 是 `injected-tokenizer-estimate`，`wallMs/usdMicros` 恒 `null`；probe 与 fixture 用 `fixture:utf8-byte/v1`，非 provider tokenizer，也不是发票成本。
3. **原生宿主激活未证明**：candidate 只到 `ActivationContextCandidate`；真实宿主注入/安全点激活不在本节点（`evidence` 明确归 l4_capability_trial）。
4. **评价/宿主回执是合成 fixture**：`EvaluationReceipt`/`ActivationReceipt`/producer/issuer 均为合成；虽经真实 registry 写路径，仍非生产回执。
5. **无向量库/GraphRAG**：符合合同「无收益前不引入」；排名为固定确定性规则（成本/身份/revision），非学习排序。
6. **运行环境**：本次证据与我的复跑均为 `Node v24.12.0`；项目最低声明 `Node 22.13` 未在本轮实际执行。
7. **m1（证据完整性）**：`evidence/results.json` 无 `sourceHashes`；本次以实时 sha256 替代（§5），建议补一份 source-hash 清单以便与后续 build 对齐。
8. **n1/n2**：见「结论」表。

---

## 5. 收工一致性

- **lane ↔ 集成 sha256（10/10 全等）**：
  - `src/learning/retrieval/types.ts` `c2967df94a747b80…7d69c047`
  - `src/learning/retrieval/retrieve.ts` `f3c989b300e3f15c…f39a9437`
  - `src/learning/retrieval/material.ts` `4308cd4bdea14c99…43c064c`
  - `src/learning/retrieval/feedback.ts` `7ac50292d4828383…b9ab1f6`
  - `src/learning/retrieval/index.ts` `54462a4ddebec7e2…ad968e65`
  - `test/l4-retrieval-selection.test.js` `809544f3905d7dd2…30fd1c8d`
  - `test/l4-retrieval-context.test.js` `4983c41fab16c1db…528aa37b`
  - `test/l4-retrieval-fixtures.test.js` `63dab426e95749f4…f92aa04f`
  - `test/l4-retrieval-rejection.test.js` `9fe375f93a9b19b9…8c55bfdc9`
  - `test/l4-retrieval-negative-controls.test.js` `144f703572164992…8f312b627`
  - lane `git status` 仍全部 untracked、HEAD 未动；集成 `git status --porcelain` 为空。
- **证据↔实况一致**：`results.json` tests 两条 32/32、`negativeControls` 4 条 `[0,1,1,0]/[1,1,0,1]/[0,1,1,0]`、`static-audit {exit 0, violations 0, modules 88, edges 358}`、`repeatedTestsIdentical/negativeControlsIdentical=true`，与我在集成环境重跑结果一致；`EVIDENCE.md` 的 4088→4978/内容 45/计算 9111/3 次 tokenizer/2 次 materialRead 与 `example.json` 逐项一致；全部 `*.stderr.txt` 0 字节。唯一缺口是 `sourceHashes`（m1）。
- **本次复核的写入**：仅本 dossier `docs/evofence-harness-kernel/execution/reviews/l4_retrieval-review.md`；未写 `.graph`、未 commit、未改 lane、未改 `src/`/`test/`；变异只经内存 ESM loader 落在 `dist/learning/retrieval/retrieve.js`，磁盘 sha256 逐字节不变，收工前已确认。
