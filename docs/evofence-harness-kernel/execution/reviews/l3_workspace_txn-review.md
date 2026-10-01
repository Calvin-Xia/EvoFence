# l3_workspace_txn 独立交叉复核（review-1）

日期 / 复核者（pane）：
- 日期：2026-10-02
- 复核者：独立 review pane（**新 tab、新 pane，未参与本节点任何写作**；全程只读，唯一写入是本 dossier）

复核对象（commit + 文件/行数 + 用例数）：
- 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，commit **`db396b190ced499fd35d70ee34111c961e39dce7`**（父 `6728aae`），相对基线 `8bffca8`（`git merge-base --is-ancestor 8bffca8 db396b1` = true；`db396b1` 自身是纯新增提交）。
- `src/runtime/workspace/**`：3 文件 / **137** 行（`index 2`、`rules 72`、`types 63`）。
- `src/workspace/**`：13 文件 / **792** 行（`README 66`、`artifacts 53`、`filesystem 59`、`git 109`、`index 6`、`io 78`、`lock 42`、`observations 28`、`provider 66`、`receipts 50`、`stages 67`、`transactions 139`、`types 37`）。
- `test/l3-workspace-*.test.js`：4 文件；`node --test` 报 **36**（= 35 条命名用例 + `l3-workspace-support.test.js` 1 个测试文件实体）。
- lane 作者工作区（仅 sha256 比对，未写）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-workspace`，branch `refactor/hk-l3-workspace`，HEAD `8bffca87866f2cb22f196630275207712c5a5fcf`，产物未提交（untracked，但与集成 HEAD 逐字节相同）。
- `git show --name-status db396b1` = **20 A**（本节点只增不改；无 L2/旧模块被改）。
- 管辖 ADR：`adr_0001`（宿主内嵌内核与显式子图委托）、`adr_0004`（事件真相源/outbox/恢复核实）；冻结依据：`INTERFACES.md` `WorkspacePort` 行、`OWNERSHIP.md` A12/A14 与 I01–I08。

## 结论：**可接受**（blocker 0 / major 0 / minor 1 / nit 2）

复核简报列的 10 条必须核验断言的**逐条独立取证通过**：base/scope 有 revision+digest 绑定且错误 base 被 typed 拒绝；非 Git 抽象真实存在（同一 provider 跑 `versioned-directory` driver）；真实 Git/FS 并发冲突→`rebase/replan`（不盲合并）；真实双进程并发下**唯一 integration writer**（1 applied、1 `EFK_CLAIM_CONFLICT`、1 dispatch）；候选 staged、不动全局目录；5 个断点 × 2 driver 的 SIGKILL/部分写崩溃后 reconcile 与实际字节一致、unknown 不盲重放；非 OS sandbox 声明一致（类型/回执/文档）；core 零 `node:fs`/`child_process` 且 `static-audit` 0 violations；门禁全 0、workspace 36/36 两次、L2 runtime 32/32、全量 945/945；变异负控 0→1→0 复现。1 个 minor 是**不与 DoD 冲突的运维观察**（候选 worktree/snapshot 无 GC），2 个 nit 是性能与本地 liveness 限制，均不影响本节点验收。

| 级别 | 数量 | 摘要 |
|---|---|---|
| blocker | 0 | — |
| major | 0 | — |
| minor | 1 | **m1**：候选/stage 产物只增不删——`git.ts` 每次 `stage`/`prepare` 都 `git worktree add`（`controlDir/stages/<id>`、`controlDir/.../app-<id>`），`filesystem.ts` 每次 stage/prepare 都新建 `stages/<id>`、`snapshots/<uuid>`，适配器内**无任何 `worktree remove`/snapshot GC**。长寿命 integration 工作区会无界增长（正确性/DoD 不受影响，属运维债）。 |
| nit | 2 | **n1** `git.ts readTree` 每文件起一个 `git cat-file blob` 子进程、`prepare` 每文件一次 `hash-object`——大树上 O(files) 进程，性能可优化；**n2** `lock.ts recoveryLock` 的存活判定用 `process.kill(pid,0)`，本机有效（README 已显式声明不支持跨机器锁协议），但 PID 复用可能把已死 writer 误判为存活→保守拒绝恢复（方向安全，仅可用性）。 |

---

## 0. 复核方法（不采信作者自报）

1. **sha256 双份比对**：20 个产物文件（3 core + 13 adapter + 4 test）在 lane ⇔ 集成工作区逐文件比对，**20/20 全等**（收工复测仍 20/20，值见 §5）。
2. **门禁实测**（集成副本；ADR-0004：测试只吃本次 build 的 `dist/`）：
   - `npm run build` → exit 0
   - `npm run typecheck` → exit 0
   - `npm run src:policy` → exit 0：`223 TypeScript file(s), largest 350 line(s) (src/lib/pi-tool-strategy.ts), limit 350; 0 JavaScript file(s)`
   - `npm run dep:check` → exit 0：`modules 223 / edges 859 / cycles 0 / acyclic: true`
   - `node --test test/l3-workspace-*.test.js` 连跑两次 → 各 `tests 36 / pass 36 / fail 0`
   - `node --test test/l2-runtime-*.test.js` → `tests 32 / pass 32 / fail 0`
   - `node verification/kernel/static-audit.mjs` → exit 0，`status passed`，`checkpoint cp3`，`moduleCount 88`，`edgeCount 358`，`violations 0`（audit 的 edges 列表含 `src/runtime/workspace/rules.ts`，确认新 core 目录在审计面内）
   - 附加：`node --test`（默认全量发现，含 L1–L3 既有套件）→ `tests 945 / pass 945 / fail 0`，无旁路回归
3. **独立探针 18 组**（自建脚本放系统临时目录，只 import 集成副本 `dist/**`，fixture/协议形状按已冻结合同自建；见 §3）。
4. **变异负控 1 组**（仅改本次 build 的 `dist/runtime/workspace/rules.js`，跑红→按备份 `cmp` 复原→复绿；见 §2）。
5. **全量源码通读**：`src/runtime/workspace/**` 3 文件 + `src/workspace/**` 13 文件（含 README）全 diff 通读，逐处核对 base/scope/冲突/单 writer/原子性/reconcile/声明。
6. 防御性编程与声明一致性以 `grep`（`node:(fs|child_process|net|http)`、`git`、`sandbox`、`??`、`catch`）+ 通读逐处核对。

---

## 1. 必须核验的断言逐条判定

| # | 断言 | 判定 | 实测证据 |
|---|---|---|---|
| 1 | base/scope：共享只读 base 有 revision/digest 绑定；base 不匹配的 patch 被拒（typed）；写 scope 隔离/受锁 | ✅ | 源码：`rules.ts checkStage` 三段硬校验——`grant.scope.workspaceRef`（id+digest）必须等于当前 workspace/base、`trustDomain` 必须 `same-user`、`sameBase(request.base,current)` 且 `binding.baseDigest===base.digest`，任一失败 → `EFK_AUTHORITY_DENIED`/`EFK_ARTIFACT_BINDING_MISMATCH`；`checkScope` 把 named resource ID 经 `resourcePaths` 解析为精确相对文件或 `dir/` 前缀，`io.ts scopedPath` 逐段 `lstat`+`realpath` 拒绝符号链接/junction/别名/穿越/Windows ADS/特殊文件。探针 **P1**（git/fs revision drift + digest drift + locator digest mismatch → 三种 typed 拒绝，且 base 未被改动）。作者用例 `cp1 {git,fs}: isolated candidates share immutable base; read/write scope and seal`、`cp1 {git,fs}: actual linked path escape is denied`、`cp2 {git,fs}: missing/stale lease, narrowed scope, false base and uncommitted effects cannot write` |
| 2 | 非 Git 抽象：策略/经验图资产不需要 Git 也能走同一 provider（或明确的范围声明） | ✅（覆盖面见 §4） | `WorkspacePort`/`WorkspaceDriver`（`runtime/workspace/types.ts`、`workspace/types.ts`）**无任何 `git` 标识**，只有 `current/files/stage/prepare/publish` 五原语；`filesystem.ts` 实现 `versioned-directory` driver（不可变 snapshot 目录 + `HEAD.json` 指针 CAS），并**复用同一 provider**跑通 cp1–cp3 全流程（作者 36 用例全部按 `for kind of ['git','fs']` 参数化）。README 明写「Non-Git assets use the same port.」。`grep git` 只命中 `git.ts` 与 README 的「Git 是可选基础设施」。 |
| 3 | DoD①：并发 patch 冲突 → 显式 rebase/replan（带冲突文件与两侧 base），不盲合并 | ✅ | 源码：`transactions.run` 先 `plan()`（`provider.apply` 内 `patchConflict`），非 null 即在**任何 dispatch/publish 之前**返回 `{disposition:'rebase/replan', conflict:{action,files,proposedBase,currentBase}}`；冲突文件按 `canonical(oldFiles[path]) !== canonical(currentFiles[path])` 精确列出。真实场景：探针 **P2**（git 与 fs 各一个真实仓库/目录，两个同 base 候选同时改 `a.txt`→ 第二个 apply 返回 `rebase/replan`、`files:['a.txt']`、两侧 base 不同、落盘仍是胜者字节、败者 outbox 仍 `intended`），**P2b**（replan 后重新 apply 成功）。作者用例 `cp2 {git,fs}: same-base concurrent patchers conflict -> rebase/replan; no blind merge`（含 SIGKILL 崩测之外的真实 Git/FS 场景） |
| 4 | 唯一 integration writer：提交串行且可证伪（并发下只有一个 writer 生效） | ✅ | 源码三重串行：① `controlDir/writer.lock`（`mkdir` 原子获取，EEXIST→`EFK_CLAIM_CONFLICT`）；② `fence.json` 比较 `leases[resourceId].fencingToken`（旧 token 或同 token 不同 owner → `EFK_LEASE_STALE`）；③ L2 journal 的 `dispatchEffect` claim + outbox `intended` 门（已 dispatch 的 effect 绝不重放）。真实双进程探针 **C1**（`fork` 两个独立 OS 进程同时 apply 同 base/同文件；两个 driver 各跑一次）→ `applied=1`、败者 `EFK_CLAIM_CONFLICT`、`effect.dispatched` 恰好 1 条、最终字节非合并。作者用例 `cp2 {git,fs}: two provider instances have a single integration writer`、`cp2 {git,fs}: old writer fencing token is rejected across provider restart`。证伪路径见 §2 变异。 |
| 5 | 候选 staged：不直接改全局 Skills / 既有资产 | ✅ | 源码：`stage` 建独立 root（git=detached worktree；fs=`stages/<uuid>`），write/diff/seal 只在该 root 内；`initializeFilesystemWorkspace` 用**非递归** `mkdir(root)`（已存在→`EEXIST`），从不导入/覆盖既有全局目录；provider 构造不做 I/O、不发现 backend。探针 **P4**（git/fs：预置外部 `external-global-skills/SKILL.md`，候选写 `skills/new/SKILL.md` → 外部文件与集成 HEAD 均不变）。作者用例 `cp1 fs: new project candidates never initialize or modify an existing global Skill directory` |
| 6 | DoD②：原子应用/撤销/恢复；journal/receipts 与实际文件状态可 reconcile（崩溃/中断后 unknown 不盲重放）；撤销恢复前状态 | ✅ | 源码：apply = 记录→prepare（不发布）→`fence`→`dispatchEffect` claim→`publish`（git=`update-ref` CAS；fs=`HEAD.json` same-volume rename）→观察→`finish`（L2 `applyReceipt`）；`publish` 失败/未观察回 `failed`；异常时若 current==before 则记 `failed`，否则保留锁与 claim 交由 `reconcile`；`reconcile` 先取 `recoveryLock`（仅在 owner 进程已死或本实例空闲时回收），再比对 journal 意图、receipt 证据 digest、实际字节，只有 `current∈{before,after}` 才落 `applied`/`not-executed`，否则回 `unknown`；`knownSuccessor` 只解释 journal 已确认的后继应用。真实崩溃：探针 **X1**（`fork` 子进程在 `candidate-file/prepared/published/receipt-saved` 四点 SIGKILL × git/fs = 8 组）→ 复开后 `unknownEffectIds=[effect]`、重 apply → `EFK_EFFECT_NON_IDEMPOTENT_RETRY`、`reconcile` 结果与实际字节严格一致（published/receipt-saved→`applied`，其余→`not-executed`）、二次 reconcile 幂等、`effect.dispatched` 恒为 1。作者用例 `cp3 {git,fs}: atomic multi-file apply/undo...`、`cp3 {git,fs}: partial candidate write failure...`、`cp3 {git,fs}: lease expiration during prepare prevents publication`、`cp3 {git,fs}: SIGKILL at {claimed,candidate-file,prepared,published,receipt-saved}...`、`DoD2 {git,fs}: receipt/actual-state mismatch stays unknown, blocks another writer` |
| 7 | **非 OS sandbox 声明**：代码/文档/回执不得宣称 worktree = OS sandbox | ✅ | 类型层：`WorkspaceBase.osSandbox`/`WorkspaceApplication.osSandbox` 均为字面量 `false`，`types.ts` 注释「Host observation, not an ActivationDecision」；`rules.ts` 错误文案「a worktree is not an OS sandbox」；`receipts.ts` 回执 `observability` 固定 `'same-user; worktree is not an OS sandbox'`；README §末「These are **same-user workspaces, not OS sandboxes**. No protection against an arbitrary same-user process, cross-machine lock protocol, power-loss durability, exactly-once external side effects, asset promotion, or native host activation is claimed.」；`parsePatch` 对任何 `base.osSandbox !== false` 直接 `EFK_SCHEMA_INVALID`。作者用例断言 `base.osSandbox===false`、`application.osSandbox===false`、回执 `not an OS sandbox`、`trustDomain:'os-sandbox'` → `EFK_AUTHORITY_DENIED`。未发现任何相反措辞（grep 全量）。 |
| 8 | core 未被污染：`src/{protocol,kernel,runtime}/**` 无 `node:fs`/`child_process`/git/网络；`static-audit` exit 0、0 violations | ✅ | `grep -rnE "from 'node:(fs|child_process|net|http|https|os|dns)'|execFile|spawn\(" src/protocol src/kernel src/runtime` → **NONE**（含新 `src/runtime/workspace/**`）。core 新文件只 import `kernel/store/{contracts,identity,artifacts/types}` 与 `runtime/host-port/{grant,types}`；`src/workspace/**` 从未被任何 core 文件 import（`grep` = NONE）。`static-audit` exit 0、`violations 0`、`status passed`。 |
| 9 | 门禁 | ✅ | build/typecheck/src:policy/dep:check 全 exit 0（数字见 §0.2）；`node --test test/l3-workspace-*.test.js` **两次各 36/36**；`node --test test/l2-runtime-*.test.js` **32/32**；`static-audit` 0 violations；附加全量 `node --test` **945/945**。 |
| 10 | 证据诚实 | ✅ | commit 自报（36/36 twice、70 fixture dirs、3 mutation negatives、L2 32/32、四门禁 0、static-audit 0）逐项实测吻合（70 = 35 fixture×2 轮，可数）；README 如实列「L2 memory reference store exports 非生产持久后端/非跨进程 DB CAS」「不承诺跨机器锁、断电持久性、exactly-once 外部副作用、资产晋升、原生激活」；lane 产物 20/20 sha256 与集成全等；变异负控抽样复现见 §2；未证明项见 §4。 |

---

## 2. 变异负控（0 → 1 → 0，仅改 `dist/`，按备份复原）

| 组 | 变异点（编译产物） | 变红用例（实测） | 复原 |
|---|---|---|---|
| **NC1** DoD① / 断言 3「冲突必须显式返回 rebase/replan」 | `dist/runtime/workspace/rules.js`：`patchConflict` 顶部 `if (sameBase(proposed, current)) return null;` → `return null;`（**绕过冲突判定**，函数恒不报冲突） | **2 fail / 0 pass**（`--test-name-pattern="conflict -> rebase/replan"`，git+fs 两条全红），精确命中 `cp2 {git,fs}: same-base concurrent patchers conflict -> rebase/replan; no blind merge`；失败为 `EFK_ARTIFACT_BINDING_MISMATCH: effect does not bind the actual application base`——第二个 writer 的证据本应得到 typed `rebase/replan`，变异后改走「盲合并/兜底 base 校验」路径而丢失 rebase/replan 语义 | 用跑前备份 `cp` 回写，`cmp` 逐字节相同（`RESTORED-IDENTICAL`）；重跑同 pattern → **2 pass / 0 fail**。未改 `src/`，未 commit |

作者自报 3 组负控（`rules.ts:61`、`transactions.ts:113`、`git.ts:67`），按简报「抽查 1 个」我复现了最关键的冲突判定组，0→1→0 成立。

---

## 3. 我方独立探针（18 组，自建脚本于系统临时目录，只 import 集成 `dist/**`）

| 探针 | 结果 |
|---|---|
| **P1** base 绑定（git/fs）：revision drift、digest drift、locator digest 不符 | PASS：三种 typed 拒绝，base 未被改动 |
| **P1b** scope（git/fs）：`outside.txt`、`skills/../escape`、`a.txt/../../x`、`.git/config`、`C:/Skills/x` | PASS：均 `EFK_AUTHORITY_DENIED`；合法 `skills/*` 可写且不触集成 |
| **P2** 真实同 base 冲突（git/fs）：两候选同改 `a.txt` | PASS：第二者 `rebase/replan`、`files=['a.txt']`、两侧 base 不同、落盘为胜者字节、败者仍 `intended` |
| **P2b** replan 后重 apply（git/fs） | PASS：`applied`，内容为 replan 字节 |
| **P3** staged 候选不触外部全局目录（git/fs） | PASS：外部 `SKILL.md` 与集成 HEAD 均不变 |
| **C1** 真实双进程并发写（git/fs，`fork` 两个 OS 进程同 base/同文件） | PASS：`applied=1`、败者 `EFK_CLAIM_CONFLICT`、`effect.dispatched=1`、最终字节 `AAAA`（单写者，非合并） |
| **X1** SIGKILL 崩溃 × {candidate-file, prepared, published, receipt-saved} × {git, fs} = 8 组 | PASS：未知 effect 记录→重放被拒（`EFK_EFFECT_NON_IDEMPOTENT_RETRY`）→`reconcile` 与实际字节一致（published/receipt-saved→`applied`；candidate-file/prepared→`not-executed`）→幂等、仅 1 次 dispatch |

（探针脚本置于 `%TEMP%\l3verify\`，只对系统临时目录做真实 fs/Git 操作；cwd 保持在集成 worktree。）

---

## 4. 未证明项与保留意见（如实）

1. **候选/stage 产物无 GC（minor m1）**：`git.ts` 的 `stage`/`prepare` 每次 `git worktree add` 到 `controlDir/stages/<id>`、`app-<id>`，`filesystem.ts` 每次新建 `stages/<id>`、`snapshots/<uuid>`，适配器内无 `worktree remove`/snapshot 清理（`grep` 确认）。功能/DoD 不受影响，但长寿命 integration 工作区会无界增长，属需后续补的运维债。
2. **非 Git adapter 覆盖度**：`versioned-directory` driver 已被 cp1–cp3 全流程真实覆盖，但**未跑真实「策略/经验图资产任务」端到端**——目前用通用文件资产代理（README 声明「Non-Git assets use the same port」，覆盖到抽象层/文件资产层，未到具体领域任务层）。
3. **Grep 类能力语义**：`readText` 以 UTF-8 往返 + `\0` 检测判定文本；二进制/非 UTF-8 一律 `EFK_CAPABILITY_UNSUPPORTED`（显式范围声明，非缺陷），未做编码协商。
4. **锁的本机性**：`recoveryLock` 用本机 `process.kill(pid,0)` 判存活；README 明示不承诺跨机器锁协议，跨机器并发不在本节点证据内（nit n2：PID 复用致保守拒绝恢复）。
5. **崩溃注入为进程级 SIGKILL**：证明的是「进程被杀、锁残留、journal/receipts 与实际字节 reconcile」，**未证明断电/磁盘级持久性**（README 已声明不承诺 power-loss durability）。
6. **git 性能**：`readTree`/`prepare` 对每个文件起子进程（nit n1），大树下 O(files) 进程，未做大仓库基准。
7. **`initializeFilesystemWorkspace` 的模式保真**：非 Windows 上以 `canonical(actual)!==canonical(initial)` 校验 executable 位；Windows 无 portable 模式位，请求 executable 会 `EFK_CAPABILITY_UNSUPPORTED`（诚实降级，非缺陷）。

---

## 5. 收工一致性

- **lane ↔ 集成 sha256**：20/20 文件全等（3 core + 13 adapter + 4 test），逐笔值（前缀…后缀）：
  - `src/runtime/workspace/index.ts` `08a93e55…70dfcd6b`
  - `src/runtime/workspace/rules.ts` `4a698e63…ca792db`
  - `src/runtime/workspace/types.ts` `43fada54…e4d4b`
  - `src/workspace/README.md` `5eaadf95…f32165`
  - `src/workspace/artifacts.ts` `1fafdbd9…68b995`
  - `src/workspace/filesystem.ts` `15377c6f…d8458d`
  - `src/workspace/git.ts` `511d7c92…5e3f`
  - `src/workspace/index.ts` `7e9cc68d…3b82b`
  - `src/workspace/io.ts` `c5d24bbb…12b267`
  - `src/workspace/lock.ts` `9a4547d2…e5a97a`
  - `src/workspace/observations.ts` `e67df074…fa6efc`
  - `src/workspace/provider.ts` `3e9ff5cc…c553a`
  - `src/workspace/receipts.ts` `35c38670…e7d708`
  - `src/workspace/stages.ts` `34ab1b93…a17bad`
  - `src/workspace/transactions.ts` `ba54788a…1b103ad`
  - `src/workspace/types.ts` `d9aab20d…4154288`
  - `test/l3-workspace-boundaries.test.js` `c0bf7780…2654d3`
  - `test/l3-workspace-provider.test.js` `bda09a27…4f9039d`
  - `test/l3-workspace-recovery.test.js` `f5052e1e…539a70fae`
  - `test/l3-workspace-support.test.js` `ce9cbd0f…1b8f22bf7`
- **git 状态**：集成 worktree `src/runtime/workspace src/workspace test/l3-workspace-*.test.js` `git status --porcelain` 为空；`git diff 8bffca8..db396b1` 中本节点贡献仅 `db396b1` 的 20 个新增文件；lane worktree HEAD `8bffca8`、产物 untracked 且与集成逐字节相同；未写 `.graph`、未 commit、未改 lane；变异仅在 `dist/`，已 `cmp` 复原（逐字节）。
- **测试与审计数字**：build 0 / typecheck 0 / src:policy 0（223 文件，最大 350）/ dep:check 0（223 模块 / 859 边 / 0 环）；workspace **两次 36/36**；L2 runtime **32/32**；全量 `node --test` **945/945**；`static-audit` exit 0、**0 violations**、`status passed`；core 无 `node:fs`/`child_process`/git/网络。
- **落点纪律**：本节点只增不覆 20 文件；core 新文件 ≤72 行、adapter 最大 `transactions.ts` 139 行、测试平铺 `test/` 根并从 `dist/**` 导入，均 ≤350，实测。
