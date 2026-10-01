# L2 wave-3A 简报：l2_artifact_port（lane: artifact）

> 图：`evofence-harness-kernel` · 阶段 L2 · 上游 `l2_state_store` 产物已并入集成分支（`ac530d8`）；本 lane 基线 `7521ebc`（含 `src/protocol/**` + `src/storage/**` + `src/kernel/policy/**`）。
> 你只写自己的产物；图状态由 orchestrator 记录，**lane 内没有 `.graph/`，不要也无法改图**。

## 0. 工作区

| 项 | 值 |
|---|---|
| worktree | `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\artifact` |
| 分支 | `refactor/hk-artifact` |
| 基线 HEAD | `7521ebc` |
| `node_modules` | 指向主 worktree 的 junction —— **不要 `npm install`、不要装包** |
| 集成点 | `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（orchestrator 合并；你不要往那里写） |

## 1. 节点合同

- **id**：`l2_artifact_port`（不可变产物与验证引用），context `ctx_store`。
- **plan**：实现 `ArtifactRef` 内容摘要、生产者身份、图/节点/attempt/base revision 绑定、权限分区与实际可用性检查；提供 workspace/evaluator/asset 的产物接口。**证据缺失或地址失效不能以 summary 通过**。输出：artifact reader/writer contract 与访问控制。
- **DoD**（逐条必须可证伪）：
  1. 产物引用可核对内容、生产者和期望版本；**对旧 base 的结果拒绝提交**。
  2. holdout 与普通 agent 可见反馈**分区**；敏感 trace 不进入默认报告。
- **checkpoints**：cp1 内容身份与 binding；cp2 访问分区与失效语义；cp3 consumer 验证与错误路径。

## 2. 物理落点与所有权

- 独占目录：**`src/storage/artifacts/**`**（新子树）。
- **不要修改**已冻结的 `src/storage/*.ts`（l2_state_store 的产物，已提交）与 `src/protocol/**`。若确实需要 store 侧改动，**停下并向我报告**（drift 由 orchestrator 收口），不要静默编辑别人的文件。
- 测试平铺在 `test/` 根，前缀 `l2-artifact-`：`test/l2-artifact-*.test.js`，从 `dist/**` 导入（ADR-0004）。
- `src/**/*.ts` 每文件 ≤ 350 行（`npm run src:policy` 硬门禁）。

## 3. 必读输入

- `docs/evofence-harness-kernel/spec/contracts/INTERFACES.md`（`ArtifactRef` 行、`ArtifactStore` 行，以及 workspace/evaluator/asset 消费方）
- `docs/evofence-harness-kernel/spec/contracts/SCHEMAS.md`（`$defs/ArtifactRef`、`Binding`、`GraphPatch`/`NodeSpec` 相关字段）
- `docs/evofence-harness-kernel/spec/contracts/OWNERSHIP.md`（A 系列边界：产物归属与可见性）
- `docs/evofence-harness-kernel/spec/contracts/README.md`（CONTRACTS §5 十条不变量——取与证据/产物相关的 4/5/6/9 就近条目）
- `docs/evofence-harness-kernel/spec/graph/SEMANTICS.md` + `EXAMPLES.md`（binding 到 graph/node/attempt/base revision 的语义）
- `docs/evofence-harness-kernel/execution/L2-PROTOCOL-NOTES.md`（如何消费协议层：唯一 `decode` 边界、`fail()`/`EFK_*`）
- `src/storage/**`（冻结参考实现：`memory-artifact-store.ts`、`contracts.ts` 里的 `ArtifactRef` 类型）
- `docs/evofence-harness-kernel/execution/tasks/L2-wave2-brief.md` §1（共享硬约束：防御性编程禁令、确定性、字段名不得改名）
- 管辖 ADR：`adr_0004`（事件真相源/outbox/恢复核实）、`adr_0009`（轻量协议内核与可选基础设施）——均已 accepted，但不得把它们未证明的运行承诺写成已证明。

## 4. 要交付的行为（建议切分到 cp1/cp2/cp3）

- **cp1 内容身份与 binding**：读路径核对 digest 与 schema；producer 身份可归因；`ArtifactRef` 绑定 graph/node/attempt/base revision；**旧 base 的提交被拒**（negative control 必须真实变红）。
- **cp2 访问分区与失效语义**：holdout/普通可见性分区，敏感 trace 不进默认报告；地址失效/证据缺失走 typed `EFK_*` 错误，绝不因 summary 存在而通过。
- **cp3 consumer 验证与错误路径**：workspace/evaluator/asset 三个消费接口的校验入口（单一入口，不散落 if）；给出错误矩阵（每个 `EFK_*` 的触发条件）。

**确定性/注入**：digest、clock 一律显式注入；纯函数对同输入逐字相同（I07）；顶层 import 零副作用（I05）；runtime 能力只来自参数端口（I08）。**防御性编程禁令**适用：契约/证据门禁、显式 unknown/reconcile、schema 显式拒绝、真实外部输入边界校验是保留项，其余"为不可能状态加守卫/吞错/双保险/惩罚式回退"删掉。

## 5. 自证与门禁（硬性）

- 在自己 lane 里：`npm run build`、`npm run typecheck`、`npm run src:policy`、`npm run dep:check` 全部退出 0。
- `npm test` 必须能发现你的测试（平铺即会被发现），给出 `ℹ tests / ℹ pass / ℹ fail` 与你新增用例名。仓库既有 `test/runner.test.js` 等高负载 wall-clock 用例有已知环境 flake（与本 lane 无关时如实标注）。
- **每条 DoD 至少一个会失败的检查（negative control）**：可临时变异→build→测试变红→改回，并报告变异点与变红的用例名。
- 不 commit、不发布、不装包；`git status` 只应显示你的新增文件。

## 6. 完成回报格式

```
lane: artifact
cp1: <passed|failed> — 证据
cp2: <passed|failed> — 证据
cp3: <passed|failed> — 证据
交付文件: <路径 + 行数，含测试>
实测命令: <命令 + 退出码>（build/typecheck/src:policy/dep:check/npm test）
测试门禁证据: <tests/pass/fail 数字 + 你新增的用例名>
未证明项: <如实列出>
阻塞: <无 / 具体>
```
