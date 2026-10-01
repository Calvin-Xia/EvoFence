# 任务简报：l2_public_contracts（实现无副作用协议层）

> 执行者：pi pane（deepseek/deepseek-flash high，**默认写作者**）。图状态由 orchestrator S02 记录，你**不要**改 `.graph/`。
> 上游：L1 已全部 passed（7/40），人审已通过。你是 **L2 的第一个节点**，其余 8 个 L2 节点等你。

## 0. 工作区与基线

- cwd：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`
- 分支 `refactor/harness-kernel`，HEAD `a4d04d5`（**已 commit，工作区干净**）
- 图真相源 `.graph/evofence-harness-kernel/`（**只读**；本 worktree 内 `graph` CLI 可用且**只能**用它）
- 上游事实来源：`docs/evofence-harness-kernel/spec/contracts/`（`l1-freeze.2`，7 份）

## 1. 节点合同（逐条满足）

**Plan**：依据冻结 schema 实现 **branded IDs、版本化 commands/events/effects、task/graph/host/evaluation/asset 类型与解析器**。业务错误为**类型化结果**；核心导入**不读取配置、Git、SQLite 或宿主凭据**。输出：protocol 入口与双方消费合同。

**DoD**
1. **未知版本/字段错误被明确返回**；无静态 native/CLI 导入。
2. **所有后续模块使用同一协议与身份映射，无重复 envelope。**

**Checkpoints**
- `cp1` 协议与 schema 实现
- `cp2` 无副作用导入核验
- `cp3`（见文件末尾）

## 2. 必须先读的输入

1. `docs/evofence-harness-kernel/spec/contracts/SCHEMAS.md`（931 行，**你实现的唯一字段真相源**：63 对象/427 字段/423 必填，`$defs` 是 draft 2020-12 JSON Schema）
2. `spec/contracts/INTERFACES.md`（版本规则、`l1-freeze.2`、接口形态、状态与图冻结、四类裁决）
3. `spec/contracts/ERRORS.md`（58 个 `EFK_*` 错误码 + 触发条件 + 重试策略）
4. `spec/contracts/OWNERSHIP.md` **§1 模块边界 + §4 的 I01–I08**（**这是你 cp2 的验收判据**）
5. `spec/graph/SEMANTICS.md`（`decide()` A1–A6/B1–B3/INV、状态机、`terminal`/`abandonedBranches`）
6. `spec/evaluation/PROTOCOL.md`（四类裁决分离：TaskDecision / CandidateDecision / PromotionDecision / ActivationDecision）
7. 管辖 ADR：`.graph/evofence-harness-kernel/nodes/adr_0009.yaml`（轻量协议内核与可选基础设施，**已 accepted**）
8. `AGENTS.md`（仓库约定）+ `package.json` / `tsconfig.json` / `scripts/check-src-policy.mjs`（**现有构建与门禁**）

## 3. 你必须先做的两个决定（写进产物并说明理由）

**决定 A：物理落点。** 冻结合同里写的"建议独占所有权：`packages/protocol`"是**逻辑槽位名**（`OWNERSHIP.md §1` 明说"命名为未来模块/导出槽位，不表示本节点创建了文件、package exports 或发布包"）。但本仓库是**单包**：`tsc` 编译 `src/` → `dist/`，`npm run src:policy` 限制 `src/**/*.ts` **每个文件 ≤ 350 行**，`npm run dep:check` 校验 `src/` 无环。
请在以下两者中选一个并说明理由：
- **(a) 落在 `src/protocol/`**（推荐）：直接进入现有 `tsc`/`test`/`dep:check`/`src:policy` 门禁，可被 `npm run check` 覆盖；代价是与旧 0.4.2 的 `src/lib/**` 暂时共存（允许 breaking，旧代码后续由 L2/L5 处置）。
- **(b) 新建 `packages/protocol/`**：更贴字面；代价是要自建 tsconfig/构建/测试接线，且**不进**现有 `npm run check`，等于绕开项目门禁。

**决定 B：schema 的单向真相源。** `SCHEMAS.md` 的 `$defs` 是可解析 JSON。你**不得**手抄成第二份漂移的真相源。请选一种并说明：
- 把 `$defs` 作为**构建期输入**（例如从 `SCHEMAS.md` 提取 json 块 → 生成 `types.ts`），并在测试里断言生成物与 `SCHEMAS.md` 一致；**或**
- 手写 `types.ts`，但在测试里**逐字段断言**与 `$defs` 一致（对象数、每对象属性集、必填集、类型表达式），使漂移必然失败。
无论哪种，**必须有一条会失败的检查**，否则 cp1 不算完成。

## 4. 交付物（`src/protocol/` 若选 (a)）

```
src/protocol/index.ts        入口（barrel，仅 re-export 本模块）
src/protocol/ids.ts          branded IDs（编译期不可互换）+ 构造/解析
src/protocol/version.ts      ProtocolVersion / namespace / schemaVersion / compatibleProtocols
src/protocol/codec.ts        解析器：未知版本 / 未知字段 → 类型化错误（DoD 第一条）
src/protocol/errors.ts       58 个 EFK_* + ErrorEnvelope + 触发/重试分类
src/protocol/objects/*.ts    63 对象的类型与校验（按 SCHEMAS 的 $defs 分组，每文件 ≤350 行）
test/protocol/*.test.ts      与现有 `node --test test/**` 一致的测试
```

## 5. 硬约束（违反即作废）

1. **I01–I08 是 cp2 的验收判据**，逐条落实：闭包内**零** bare specifier / node builtin（含 `node:*` 与别名）、零动态 import/require/eval/Function、顶层无 I/O、无默认 backend / 隐式单例 / fallback 网络实现、Clock/随机种子/Digest 一律显式注入。**注意**：`node:path`/`node:crypto` 也在禁止名单内——需要时走注入端口或纯实现。
2. **不碰** `.graph/`、`integrations/`、`templates/`、旧 `src/lib/**`、`src/cli.ts`、`src/index.ts`、`test-e2e/**`。**不改** `package.json`（若确需改 exports/scripts，**先报我**，那会影响发布面）。
3. **不 `git commit`**（我来提交）。**不发布、不装包**。
4. **未知字段必须报错**，不得静默忽略或剥除；**未知版本必须报错**，不得尝试兼容。这是 DoD 第一条，不是你自选的严格程度。
5. **禁止防御性编程**（用户直接指令，硬性要求）：禁止为不可能状态加运行时守卫、禁止吞错、禁止双保险（同一不变量在调用方与被调方各查一次）、禁止惩罚式回退、禁止把缺失当默认值。**例外（必须保留，不算防御性编程）**：① 契约/证据门禁；② 显式 `unknown` 与 reconcile 语义；③ 预算真预留（缺 usage 不归零）；④ **schema/版本显式拒绝**（本例的 DoD 第一条正属此类）；⑤ 真实外部输入（argv/YAML/宿主回执/文件系统）的**边界校验**。
   判据自问："这段去掉后，是否存在一个**真实可达**的输入能让系统静默出错？"答否则删。
   **特别注意**：`SCHEMAS.md` 的解析器是**边界**，那里的校验要写足；模块**内部**之间不要互相重复校验同一个不变量。
6. 中文注释可，但标识符/错误码/字段名一律用 `SCHEMAS.md` 的英文原名，**不得改名**（DoD 第二条"无重复 envelope"）。
7. 测试按变更运行；`npm run build` 后必须用**本次 build 的 `dist`** 跑测试（`npm test` 已含 build），不得读陈旧 `dist`。

## 6. 完成时回报格式

```
决定A: <(a)|(b)> — 理由
决定B: <生成|手写+断言> — 那条会失败的检查是什么
cp1: <passed|failed> — 证据（对象数/字段数/解析器拒绝用例）
cp2: <passed|failed> — I01–I08 逐条怎么核的（命令 + 输出）
cp3: <见下>
交付文件: <路径列表 + 行数>
实测命令: <命令 + 退出码>
未证明项: <如实列出>
阻塞: <无 / 具体>
```

**cp3** = 请在 `docs/evofence-harness-kernel/execution/` 下写 `L2-PROTOCOL-NOTES.md`，记录：决定 A/B 的理由、I01–I08 的落实方式、以及**给下游 8 个 L2 节点的消费合同**（他们怎么 import、哪些是稳定面、哪些还会变）。
