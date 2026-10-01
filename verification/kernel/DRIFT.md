# cp3 drift — resolved（S05 纯搬迁修复）

基线：`aca28835110bf6717936d8e73f79dc7095a20711`，`refactor/harness-kernel`。
结论：**resolved，cp1/cp2/cp3 全 passed。** orchestrator S05 明确授权纯契约/纯判定搬迁到 kernel，storage 只保留 backend；不改冻结合同、不加 allowlist、不操作 `.graph`。以下保留原原因和失败证据，再记录修复。

## 合同与实际引用

`docs/evofence-harness-kernel/execution/L1-REPLAN-DECISION.md` R1 已批准 core 闭包仅含 `protocol/kernel/runtime`。
`spec/contracts/OWNERSHIP.md` I01 要求 AST 检查完整 import/export 闭包，包含 type-only 和转发；冻结 JSON 明列 `runtime: [protocol, kernel, runtime]`。

修复前实际：`src/runtime/session/service.ts:2` 直接 import `../../storage/index.js`。其他引用共 **14 条（11 条值引用、3 条 type-only），涉及 session 的 9 个文件**，见 [pre-fix/static-audit.json](evidence/pre-fix/static-audit.json) 的 `violations`。

完整可达路径的最小例子：

```text
dist/runtime/session/index.js
  -> service.js
  -> ../../storage/index.js
  -> memory-event-store.js / memory-snapshot-store.js / memory-artifact-store.js
```

其中 artifact consumer 也通过 `storage/artifacts/index.ts` 引入。没有观察到应用服务主动构造 backend；**构造惰性不改变静态闭包已经越界的事实**。
这是冻结边界冲突，不是运行期间发现了实际 SQLite/磁盘 I/O，也不是依赖环。

## 修复后复验（原失败只保留作历史证据）

```powershell
node verification/kernel/static-audit.mjs
# exit 0；status passed；violations 0；原 14 violations 保存在 pre-fix/static-audit.json。

node verification/kernel/run.mjs
# build 0；12 条轨迹摘要与修复前逐字节相同；cp1=passed cp2=passed cp3=passed；exit 0。
```

无需安装、修改源码、修改 graph 或启动真实宿主。源码片段和 AST 引用表都可独立核查；禁止将 `npm run dep:check` 的 `acyclic: true` 解读为 I01 已通过。

## 修复记录

- `src/storage/{contracts,identity,projection,outbox}.ts` → `src/kernel/store/`，artifact 8 文件 → `src/kernel/artifacts/`；新建只重导纯契约/纯函数的 `kernel/store/index.ts`。
- runtime/session 的 9 个文件 14 条 import 改为 kernel；memory backend/store-session 导入 kernel；storage/index 同名导出面保持不变。
- 5 个 artifact 测试仅将 import 改到 dist/kernel/artifacts/index.js，所有断言保留。没有改语义、签名、SessionPorts 或冻结 allowlist。
- 完整 [移动/修改清单](MIGRATION.md)、[原始源文本](evidence/pre-fix/relocation-sources.json)、[31 个文件的非 import 字节比对](evidence/relocation-verification.json)。
- [最新静态核验](evidence/static-audit.json)：79 modules / 318 import-export entries / 0 violations；[最新门禁](evidence/gates/results.json)：四项均 0，npm test 814/814/0；[7 个变异](evidence/mutations/results.json) 均重新绿→红→复绿。
- [轨迹比对](evidence/command-repeatability.json)：12 条摘要与修复前逐字节相同，所有轨迹两次一致。新整条命令末行报告 cp3 passed/0 violations，因而 stdout 汇总哈希改变；逐条轨迹摘要没有改变。

## 已核实的唯一 wiring（修复前后不变）

- `session.plans.dispatchAdmission` → `kernel/policy.decide`（plans.ts:44）。
- `session.plans.planRound` → `scheduler.computeFrontier` / `dispatchRound`（plans.ts:57/65）。
- `session.evaluation.evaluateSession` → 注册 `EvaluatorPort.evaluateTask` → `graph.decide`（evaluation.ts:23/50），记录决策与状态转移同事务提交。
- `session.plans.factsFor` 的输入来自生产 journal 投影、当前 attempt、已应用 receipt 和活跃 lease；`scheduler.frontier` → `graph.evaluateReadiness` → 唯一 `graph.decide`。
- `session.project.reduce` → `policy.reserve/settle`；replay 与 receive preview 使用同一 reducer。
- 静态 AST 清单确认这些入口确实被调用；session 源码无 `NOT WIRED`，未直接调用 `stateFromDecision/matchingOutgoing/evaluatePredicate/checkEnvelope/grantLease/claimNode` 另立判定。
- `L2-PROTOCOL-NOTES.md` 的协议唯一入口符合：生产消费从 `protocol/index` 进入，没有深引对象分组。
- `adr_0004` 的 journal/outbox/unknown/reconcile 行为有 cp1/cp2 证据；该导出 ADR 当前文本标 proposed，不由本 lane 改动或代签。

静态清单不构成对任意反射/间接回调的形式化证明。本次遵循 S05 授权修复引用，没有改变已批准的边界，没有把 storage 加进 allowlist。残余 L3/耐久/发布面限制见 README。
