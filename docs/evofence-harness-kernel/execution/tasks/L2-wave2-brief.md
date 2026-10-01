# L2 wave-2 共享简报（4 条并行 lane）

> 图：`evofence-harness-kernel` · 阶段 L2 · 上游 `l2_public_contracts` 已 passed（提交 `d47f0ca`）
> 四条 lane **并行**，各自独立 worktree，**互不重叠**。图状态由 orchestrator S02 记录，**你们都不要改 `.graph/`**（lane 里也没有 `.graph`，物理上写不了）。

## 0. 你的工作区（每人一条，只在自己那条里干活）

| lane | 你的 worktree | 你的分支 | 你独占的代码目录 |
|---|---|---|---|
| store | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\store` | `refactor/hk-store` | `src/storage/**` |
| graph | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\graph` | `refactor/hk-graph` | `src/kernel/graph/**` |
| policy | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\policy` | `refactor/hk-policy` | `src/kernel/policy/**` |
| hostport | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\hostport` | `refactor/hk-hostport` | `src/runtime/host-port/**` |

- 每条 lane 的 `node_modules` 是**指向主 worktree 的 junction**——**不要 `npm install`、不要装任何包**（会污染共享依赖）。
- 基线 HEAD `d47f0ca`，已含 `src/protocol/**`（协议层，**只读**）。
- 主 worktree（`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`）是集成点：**由 orchestrator 合并你们的产物**。你**不要**往那里写。

## 1. 必须全部遵守的共享约束

1. **物理落点用 `src/`，不用 `packages/`。** 冻结合同里写的 `packages/storage` 等是**逻辑槽位名**（`OWNERSHIP.md §1` 明说"不表示本节点创建了文件/package exports/发布包"）。本仓库是单包：`tsc` 的 `rootDir` 是 `src`，`test`/`dep:check`/`src:policy` 全在 `src/` 上跑。落 `packages/` 会把验收挪出门禁。
2. **`src/**/*.ts` 每个文件 ≤ 350 行**（`npm run src:policy` 会查，超了直接失败）。
3. **测试必须平铺在 `test/` 根**，命名 `<你的前缀>-*.test.js`（`l2-store-` / `l2-graph-` / `l2-policy-` / `l2-hostport-`）。**原因（实测）**：本仓库里 Node 的默认 `--test` 发现**不下钻 `test/` 子目录**——放进 `test/sub/` 的测试不会被 `npm test` 跑到，等于没有。测试从 **`dist/**`** 导入（ADR-0004），不是从 `src/**`。
4. **只写你的独占目录 + 你的平铺测试**。**不要碰**：`src/protocol/**`（只读依赖）、`src/lib/**`、`src/cli.ts`、`src/index.ts`、`test-e2e/**`、`integrations/`、`templates/`、`package.json`/`package-lock.json`、`scripts/**`（除非你独占的脚本名）、其他 lane 的目录。
5. **不 `git commit`**（orchestrator 统一提交）、**不发布**、**不装包**。
6. **禁止防御性编程**（用户直接指令，对所有 harness 生效、对 gpt 系为硬性要求）：
   禁止——为不可能状态加运行时守卫；吞错（空 catch / 静默继续 / 把错误转默认值）；双保险（同一不变量在调用方与被调方各查一次；上层查过的下层再查）；惩罚式回退（为"万一"写从未设计也未测试的降级路径）；把缺失当默认（0/空/默认而不是显式失败）；同一函数内多道断言重复确认同一前提。
   **例外，必须保留且不算防御性编程**：① 契约/证据门禁；② 显式 `unknown` 与 reconcile；③ 预算真预留（缺 usage 不归零）；④ schema/版本显式拒绝；⑤ **真实外部输入**（argv/YAML/宿主回执/文件系统/AST）的**边界校验**。
   判据自问：**"这段代码去掉后，是否存在一个真实可达的输入能让系统静默出错？"** 答"否"而仍保留 → 删。答"是" → 归上表 1–5 哪一类，写注释说明。
7. **确定性**：Clock、随机种子、Digest 一律**显式注入**；纯 reducer / 协商函数对同输入必须给出**逐字相同**结果（`I07`）。顶层/静态初始化**不得**调用端口、构造 backend、发请求、开 DB（`I05`）。
8. **字段名/错误码用 `SCHEMAS.md` 的英文原名，不得改名**；错误走 `src/protocol/errors.ts` 的 `EFK_*`，不要自造第二套 envelope。

## 2. 你的输入（先读）

共享：
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md` —— **协议层的消费合同**（唯一入口、稳定面、会变的面）**必读**
- `docs/evofence-harness-kernel/spec/contracts/{SCHEMAS.md,INTERFACES.md,ERRORS.md,OWNERSHIP.md}` —— 冻结契约（`l1-freeze.2`）
- `docs/evofence-harness-kernel/spec/graph/{SEMANTICS.md,EXAMPLES.md}` —— 图语义与 10 个可判定工作例
- `src/protocol/**`（只读） —— 你要 import 的东西
- 管辖 ADR：`adr_0004`（事件真相源/outbox/恢复核实）、`adr_0009`（轻量协议内核与可选基础设施）**均仍为 proposed**——不得把它们的运行承诺写成已证明

---

## 3. lane: store ｜ `l2_state_store`（不可变产物与验证引用 / 执行 journal、投影和 outbox）

**Plan**：实现 `EventStore` / `SnapshotStore` / `Outbox` / `ArtifactStore` 的 **memory reference** 与可选持久实现；先定单机 writer / CAS / revision 与**原子 journal+outbox**。旧 ledger **不承担恢复真相源**。输出：可重放会话、schema namespace、崩溃点处理与幂等提交接口。
**DoD**：① 重复、缺口、乱序、版本不兼容与 CAS 竞争有明确定义；② **重放只重建状态；未知外部 effect 进入 reconciliation，不自动重发**。
**重点提示**：`CONTRACTS §5` 十条不变量里的 4/5/6/9 条（journal 与 outbox 同事务、请求与 receipt 可重复送达只应用一次、unknown 必 reconcile、schema/epoch/sequence 缺口不得用缓存投影假装恢复）。**memory 实现就是本节点的验收对象**（人审 R2 已裁定：耐久 backend 是可选的独立实现，不在 core 依赖内，不作 L2 门槛）。

## 4. lane: graph ｜ `l2_graph_model`（图编译器与原子修订）

**Plan**：实现 `GraphSpec` 编译、依赖投影检查、类型边解析、输入输出 artifact 绑定、图 revision 与 **patch transaction**。节点状态与执行 attempt 分离；修复创建**新 attempt 或子图**，不篡改历史。输出：`CompiledPlan` 与可验证图差异。
**DoD**：① 禁止悬空引用、隐藏依赖环、无界 repair 与不完整必需 fan-in；② **禁止修改 leased 节点输入；撤销分支需保留理由并重新验证合同**。
**重点提示**：`SEMANTICS §5.1` 的 **11 项原子校验**是你的核心；`§3.0` 的判定函数（事件 A 规则 A1–A6、事件 B 规则 B1–B3、兜底 `INV`）要实现成**单一入口**而不是散落的 if；`terminal` / `abandonedBranches` 的载体见 `§2.4`；资源是**节点声明而非边**（`§3.2`）。`EXAMPLES.md` 的 10 个例是你的 accept/fail 判据。

## 5. lane: policy ｜ `l2_policy`（授权、观测与总预算服务）

**Plan**：实现 `AuthorityGrant`、`RiskPolicy`、`HostManifest` capability requirements、`UsageCompleteness`、预算预留/结算与**嵌套累计**。只对**所需且未提供**的保证拒绝或降级；普通任务可禁用演化继续。**硬上限只有在可证明 request-time cap 时才声明；后验成本不得包装为硬 cap**。输出：单一 policy decision 与 budget ledger。
**DoD**：① **授权不因模板/修图而扩大；缺失 telemetry 不作为 zero**；② planner/workers/reviewer/learning/eval **都计入总账**；并发 reservation **不复制预算**。
**重点提示**：`adr_0008`（对照、盲测与总预算）、`spec/evaluation/METRICS §7`（包络 `9547 µUSD/请求`、S1 `20/190940`、S2 `40/381880`、S3 `80/763760`、`missingUsagePolicy: retain-reservation`）、`CONTRACTS §5.3`（先预留后结算，取消后只释放已证实未花费部分）。**人审 R7 已裁定接受 same-user 信任域**（`Scope.trustDomain`），但**任何地方不得宣称 hooks 或 worktree 等于 OS 沙箱**。

## 6. lane: hostport ｜ `l2_host_port`（宿主 ports 与委托协议）

**Plan**：实现 `HostPort` 的 `observe` / `execute` / `cancel` / `reconcile` / `context` / `usage`，以及 **scoped `DelegationGrant`**。effect 可包括执行现有 loop、tool/evaluator、child session；**内核不调用子 CLI 替代宿主会话**。输出：**host fake**、标准 receipt 与契约核验入口。
**DoD**：① 每个 effect 有 `epoch` / `idempotency` / `authority` / `budget` 关联；② **host 不支持所需能力时给 typed unsupported；不伪造效果完成**。
**重点提示**：本节点交付的是 **fake host**（真实 DSH/Pi adapter 属 L3）。`Receipt` 必须支持"重复送达只应用一次"，`cancel` 未确认必须能表达为 `unknown` 而不是伪造 `cancelled`（人审 R6 已裁定：父子/工具取消**不作 task hard**，取消未确认记 `EFK_CANCEL_UNCONFIRMED` 且**保持 `unknown`**）。`I08`：runtime 的外部能力**只能取自参数 ports**——无默认 backend、无隐式 global 单例、无 fallback 网络实现。

---

## 7. 完成时回报格式（每人一份）

```
lane: <store|graph|policy|hostport>
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
交付文件: <路径 + 行数，含测试>
实测命令: <命令 + 退出码>（至少：npm run build / npm run typecheck / npm run src:policy / npm run dep:check / npm test）
测试门禁证据: <npm test 的 tests/pass/fail 数字，并指出哪几条是你新增的>
未证明项: <如实列出>
阻塞: <无 / 具体>
```

**自证要求（硬性）**：
- `npm test` 在**你自己的 lane** 里必须**全绿**，且你新增的测试**确实被 `npm test` 跑到**（平铺在 `test/` 根，不要在子目录）。请贴 `ℹ tests / ℹ pass / ℹ fail` 与你的测试名。
- `npm run src:policy`、`npm run dep:check`、`npm run typecheck`、`npm run build` 全部退出 0。
- **每条 DoD 至少一个会失败的检查**（negative control），证明你的验收不是同义反复。
