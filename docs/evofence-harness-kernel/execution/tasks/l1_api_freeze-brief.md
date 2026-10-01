# 任务简报：l1_api_freeze（双宿主公共协议与边界定案）

> 执行者：codex（pane wG:p3，cwd = 本 worktree）。图状态由 orchestrator S02 记录，你**不要**改 `.graph/`。
> 上游三件输入已全部 passed：`l1_dsh_probe`、`l1_pi_probe`、`l1_graph_contract`、`l1_eval_protocol`。
> 你的下游是 `l1_replan`（**requires_human 人审门**）——本节点是 L1 的最后一块拼图，产物直接进人审。

## 0. 工作区与基线

- cwd：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`
- HEAD `d47f883`（detached）；源码零改动；untracked：`docs/evofence-harness-kernel/`、`scripts/probes/`
- 图真相源：`.graph/evofence-harness-kernel/`（**只读**）
- 只写本简报第 5 节列的路径（`spec/contracts` lane）

## 1. 节点合同（逐条满足）

**Plan**：输入＝两个宿主能力矩阵、图语义与评测协议。**冻结** `TaskContract` / `GraphSpec` / `Command` / `Event` / `Effect` / `HostManifest` / `DecisionRecord` / `AssetRef`、取消/预算/错误协议及**可导入边界**；能力协商**由 task requirements 决定，不按品牌白名单**。输出＝版本化接口合同、schema 与模块所有权清单。

**DoD**
1. **两个宿主都可映射每个必要合同字段**，不能映射者有**明确替代与审批项**。
2. **唯一裁决服务、持久真相源、宿主执行权与权限根无重叠**。

**Checkpoints**
- `cp1` 整理跨域 schema 和数据流
- `cp2` 映射 DSH/Pi 差异
- `cp3` 冻结接口与所有权

## 2. 必须完整读的输入（都已 passed，是你唯一的授权事实来源）

| 输入 | 位置 | 你要从它拿走什么 |
|---|---|---|
| DSH 能力矩阵 | `docs/evofence-harness-kernel/probes/dsh/README.md`、`HOST-MANIFEST.json`、`VERSION-PIN.json`、`offline-trace.json` | 29 项能力（15 verified / 1 partial / 13 unknown / 0 absent）；hooks 覆盖；team/projection/cancel/resume 的真实边界；**integration package 仍钉 `dsh 0.1.7-rc.1`** 的缺口 |
| Pi 能力矩阵 | `docs/evofence-harness-kernel/probes/pi/README.md`、`HOST-MANIFEST.json`、`VERSION-PIN.json`、`offline-trace.json`、`live-trace.json` | 固定 Pi `0.87.1`；extension hooks（context / tool_call / tool_result / appendEntry / before_provider_request / agent_end / agent_settled）；child SDK session 隔离；**`reasoningHighGuarantee: partial`**（`high` 只是参数被接受，服务端独立档位未证实） |
| 图执行语义 | `docs/evofence-harness-kernel/spec/graph/SEMANTICS.md`、`EXAMPLES.md` | 7 类节点、产品状态机、6 种边 × 5 维、判定函数 `A1–A6 / B1–B3 / INV`、`terminal` / `abandonedBranches` 载体、11 项原子校验、资源是节点声明而非边 |
| 评测协议 | `docs/evofence-harness-kernel/spec/evaluation/` 五份 | 四类判定分离（TaskDecision / CandidateDecision / PromotionDecision / ActivationDecision）、`evaluateTask` vs `evaluateCapability`、预算三分、`inconclusive` 触发 |
| 协议草案 | `docs/evofence-harness-kernel/CONTRACTS.md` | §1 对象字段、§2 服务轮廓、§4 状态机、§5 十条不变量、§6 四类判定与错误族、§7 资格不变量、§9 breaking 与保留 |
| 管辖 ADR | `.graph/evofence-harness-kernel/nodes/adr_0009.yaml`（**必读**） | 轻量协议内核与可选基础设施——`core` 不得强依赖 CLI / Git / native SQLite / super-plumber |

另需读：`adr_0001`（宿主内嵌内核与显式子图委托）、`adr_0004`（事件真相源、outbox 与恢复核实）、`adr_0006`（双宿主同等准入与显式差异）、`adr_0010`（全面 breaking 与旧数据保留）。**这些仍是 proposed**——你的产物是"供人审定案的冻结提案"，不得把它们写成已 accepted。

## 3. 必须给出的实质决定（写进产物，逐条有明确立场）

1. **版本标识**：新 namespace 叫什么？（`CONTRACTS.md` §9 只给了示例 `evofence.runtime/1`，未定案。）给出确切的字符串与语义（哪些变更是 minor、哪些必须进下一个 major）。
2. **可导入边界**：`core` 的 import 图里**不允许**出现什么？（CLI、Git、native SQLite、super-plumber、进程模型、网络、时钟……）给出**可机检的规则**（例如"依赖图不含 node:child_process / better-sqlite3 / simple-git"），而不是原则口号。
3. **字段级映射表**：对 §1 的每个对象、每个必要字段，列 `DSH 映射 | Pi 映射 | 是否两者都可映射`。**凡是有一侧不能映射的**，写明：替代方案是什么、代价是什么、是否需要人审批准。
4. **错误码表**：`CONTRACTS.md` §6 只给了错误**族**。冻结到具体 code（`固定字符串`），并说明每个 code 的触发条件与是否可重试。
5. **权威不重叠证明**（DoD 第二条）：逐条论证「唯一裁决服务 / 持久真相源 / 宿主执行权 / 权限根」四者**边界不重叠**，并给出**可检验的判据**（例如"DSH team board 只能是执行投影或被显式授予子图 authority，二者不得同时声称拥有同一 claim——判据：任一时刻 claim 的 owner 在 journal 中唯一"）。
6. **能力协商**：写清"由 task requirements 决定"的**具体算法**——给定一个 `TaskContract.requiredGuarantees` 与一份 `HostManifest`，如何决定 "可执行 / 需降级 / unsupported"？**不得**出现按宿主品牌白名单的分支。
7. **`l1_replan` 要用的输入**：把"需要真人定案的项"单独成节（本节点可能无法自行定案的分歧，例如是否要求 `integrations/` 的 DSH integration package 跟随升级到 0.2.0-rc.2）。

## 4. 已知的、必须如实处理的冲突（不要抹平）

1. **版本漂移**：全局 DSH 被外部升级到 `0.2.0-rc.2`，而设计期假设与 `integrations/` 的 peer 都是 `0.1.7-rc.1`。请在映射与审批项里如实写"目标是 0.2.0-rc.2 的实测能力；integration package 需升级或声明不兼容"。
2. **`high` 档位未证实**（Pi）：协议必须能表达"参数被接受但服务端档位未证实"，不得把它当成已验证的能力。
3. **DSH 侧 0 次付费请求**：DSH 的 live 证据等级**低于** Pi 侧（Pi 有 2 次真实付费请求）。映射表里必须体现这个等级差，不得让两侧看起来等价。
4. **`teamMessageDurable: false`**（DSH）：消息投递未成立——任何依赖"消息可靠送达"的合同字段都必须标为部分支持或给出替代。
5. **OS 隔离 = unknown**（DSH）：不得在任何地方把 hooks 或 worktree 说成 OS 沙箱。

## 5. 交付物（全新 lane，无冲突）

```
docs/evofence-harness-kernel/spec/contracts/README.md        lane 索引 + 一页结论
docs/evofence-harness-kernel/spec/contracts/INTERFACES.md    版本化接口合同（对象、服务、不变式、版本规则）
docs/evofence-harness-kernel/spec/contracts/SCHEMAS.md      字段级 schema（每个字段：名称/类型/必填/语义/来源）
docs/evofence-harness-kernel/spec/contracts/HOST-MAPPING.md 每个必要字段 → DSH / Pi 映射 + 不可映射者的替代与审批项
docs/evofence-harness-kernel/spec/contracts/ERRORS.md       冻结的错误码表
docs/evofence-harness-kernel/spec/contracts/OWNERSHIP.md    模块所有权 + 权威不重叠的可检验判据
docs/evofence-harness-kernel/spec/contracts/OPEN-ITEMS.md   必须真人定案的项（l1_replan 的输入）
```

## 6. 硬约束

1. 不打印/不写盘任何凭据。
2. 不改 `.graph/`、`src/`、`test/`、`test-e2e/`、`integrations/`、`package.json`；**不写** `docs/evofence-harness-kernel/CONTEXT-MAP.md` / `DECISIONS.md` / `contexts/` / `adr/`（那些由 `graph export --docs` 生成）。
3. 不 `git commit`；不发布；不装包。只写第 5 节列的路径。
4. **不得**把 proposed ADR 写成 accepted；不得代签任何人审结论。
5. 映射表里每个"可映射"的判定，必须能指向 Pi/DSH 探针产物里的**具体证据条目**（能力名 + 状态），不允许凭文档想象。做不到就标 `unknown` 并进 `OPEN-ITEMS.md`。
6. 中文书写，术语首次出现给英文原文；表格优先。

## 7. 完成时回报格式

```
cp1: <passed|failed> — 一句话证据
cp2: ...
cp3: ...
交付文件: <路径 + 行数>
关键决定: <6-10 条：版本标识 / 可导入规则 / 错误码数 / 权威不重叠判据 / 能力协商算法要点>
不可映射与替代: <列出一侧不能映射的字段数 + 其中最需要人审的 3 条>
须真人定案: <OPEN-ITEMS.md 里最关键的 3-5 条>
实测命令: <命令 + 退出码>
阻塞: <无 / 具体描述>
```
