# kernel-verification lane 证据包

**cp1 passed / cp2 passed / cp3 passed（S05 已修复 I01 drift）**。纯契约/纯判定上移到 kernel，冻结 allowlist 不变；原原因与修复记录见 [DRIFT.md](DRIFT.md)，完整清单见 [MIGRATION.md](MIGRATION.md)。
基线 HEAD `aca28835110bf6717936d8e73f79dc7095a20711`；Node `v24.12.0`；使用既有依赖，没有 install/commit/graph 操作。

## 可运行入口

```powershell
node verification/kernel/run.mjs                 # 先 build；运行全部轨迹两次；cp1/cp2/cp3 passed，exit 0
node verification/kernel/capture-evidence.mjs    # 整条命令独立两遍；同时与修复前摘要逐字节比对
node verification/kernel/run.mjs --scenario crash-after  # 单条复现，证据写入 evidence/reproduce/crash-after
node verification/kernel/verify-gates.mjs        # 四项门禁 + 字面 npm test，保存完整 stdout/stderr
node verification/kernel/run-mutations.mjs      # 在刚构建的 dist 上，以进程内 loader 做绿/红/复绿
node verification/kernel/static-audit.mjs       # 只读 AST；冻结 allowlist；passed/0 violations/exit 0
node verification/kernel/verify-relocation.mjs  # 31 个既有文件除来源路径外字节不变，测试断言不变
```

`run --skip-build` 仅用于刚 build 后的同轮取证，不是干净 checkout 默认入口。
无需网络、宿主登录或模型请求。所有交付测试从本次 `dist/**` 加载生产实现；两个平铺测试文件分别 6/12 行，共 12 个用例。

## 轨迹与错误证据

每条轨迹包含：端口观测 log、每个 checkpoint 的节点/attempt/epoch、outbox、预算、计数、生产 snapshot 的摘要、完整导出 journal、artifact refs 与实际 bytes。
日志是 verification 端口包装的实际观测记录；`SessionPorts` 未提供 production LoggerPort，未冒充它。

| checkpoint | 场景 | 主要观察 |
|---|---|---|
| cp1 | ordinary | create 接受；events/effect intention 同 revision；dispatch 前真实 claim/预留/lease；实际 artifact bytes；host 到 verifying；注册 evaluator 到 succeeded；close 导出后恢复恒等 |
| cp1 | repair | evaluator 的 privateTestsPassed=false + repair；原失败 attempt 保留；修复目标的独立 attempt 2 执行并成功 |
| cp1 | delegation | 调用生产 delegate 收窄 depth/concurrency；host.delegate 携带子图 pin、child grant；共享 pool 结算；扩大范围被拒 |
| cp2 | concurrency | Promise 竞争 planner CAS / effect claim 各一个胜者；两个 writer attempt 仅一个持有排他 lease；过期后 replacement token 递增；旧回执归档 |
| cp2 | cancellation | EFK_CANCEL_UNCONFIRMED；原工作与控制 effect unknown；保留预留；恢复/再次 step 不重发 |
| cp2 | budget | incomplete usage 保留 100；共享并发预算拒新预留；actual 237 对 cap 200 照实结算并报告超支；policy 拒后续；冲突 usage 拒绝；重复 webhook 不重复收费 |
| cp2 | crash-before | intention commit 前抛异常；零 effect/预留/host call；恢复后正常派发一次 |
| cp2 | crash-intended | intention commit 后、dispatch claim 前抛异常；恢复 intended；派发一次且 requestCount 不重复 |
| cp2 | crash-after | dispatch claim 与 native fake 执行后、ack 前抛异常；恢复 unknown；没有证据则保留；实际 fake host receipt reconcile 后解决，无再执行 |
| cp2 | epoch | unknown → pause/resume epoch 2；旧 epoch 回执归档，节点/预算恒等；duplicate 幂等；恢复不重发 |
| cp2 | stale-lease | 过期 lease 阻断 dispatch，EFK_LEASE_STALE；迟到 receipt 不结算 |
| 边界 | boundary-errors | 撤销、协议、伪造 evaluator、receipt identity、sequence gap、board 第二 owner、source pin 逐条拒绝 |

12 条轨迹每条两次规范化 JSON/哈希相同，且全部摘要与 [修复前摘要](evidence/pre-fix/repeatability.json) **逐字节相同**；[repeatability.json](evidence/repeatability.json)、[command-repeatability.json](evidence/command-repeatability.json) 保存逐条证据。整条命令两次 exit 0/stdout 一致；stdout 相比修复前只有末行 cp3/status/violations 从 failed/14 变为 passed/0，轨迹行无变化。
[error-matrix.json](evidence/error-matrix.json) 包含 **17 条错误路径**的实测冻结码、触发输入和独立复现命令；资源 capacity 与 dependency wake 属 defer/wake，不伪造错误码。

## 门禁与变异

[gates/results.json](evidence/gates/results.json)：build/typecheck/src:policy/dep:check 均 exit 0；`npm test` **tests 814 / pass 814 / fail 0 / cancelled 0**，其中新增 12 个用例的真实标题均在原始报告中。
src:policy：191 个 TypeScript 文件、最大 350 行、0 JavaScript；dep:check：191 modules / 706 edges / cycles 0。文件数增加 1 来自纯 core barrel，不是新增测试。
完整输出保存在 `evidence/gates/*.stdout.txt` / `*.stderr.txt`。本次门禁期间 `src/**` 全部 194 个文件 SHA-256 前后相同；S05 实际修改则由 [relocation-verification.json](evidence/relocation-verification.json) 证明仅搬迁/import 来源更新。协议、冻结合同、ledger/schema 未修改，SessionPorts 和测试断言未变。

[mutations/results.json](evidence/mutations/results.json) 记录 7 个生产行为变异，每项 **green 0/1 pass → red 1/1 fail → restored 0/1 pass**，均以断言失败取证：

1. host completion 直接 succeeded，跳过 evaluator。
2. intention 缺 outbox effect bytes。
3. claimed unknown 进入可派发列表。
4. incomplete usage 变成 complete/0。
5. 删除旧 epoch 归档条件。
6. 绕过生产 policy budget 判定。
7. 修改 graph.decide 的 succeeded 返回。

loader 只替换子进程模块内存，每项比对原 dist 文件 SHA-256；不做变异源码/磁盘 dist 写入。每项有独立 green/red/restored 原始输出和被命中的测试名；unknown-resend 现在命中实际使用的 `dist/kernel/store/outbox.js`。cp3 经 S05 的生产纯搬迁修复，静态 audit 实测 79 modules/318 import-export entries/0 violations，不修改 allowlist。

## 未证明项

- 真实 Pi/DSH 的执行、取消、child lifetime/usage 完整性、activation 和双宿主闭环仍归 L3。delegate 轨迹证明请求路径与 pin/grant/pool 绑定，不证明真实子图内部执行或 runtime 动态 GraphPatch 提交。
- EventStore/SnapshotStore/ArtifactStore 是生产 memory reference；本轮经 JSON 导出/全新 store 恢复注入 crash，不证明断电、磁盘 fsync 或 SQLite 耐久性。符合已批准 R2 的 L2 范围。
- close 是生产 export API，不额外杜撰 session.closed 事件；SnapshotStore 在 verification 侧显式 save/recover，应用服务当前依赖 journal replay。
- same-user 是本轮信任域，不是 OS sandbox；无外部副作用 exactly-once 或能力收益结论。
- I04/I05/任意反射与间接回调完整 provenance、发布 `evofence/core` export 闭包未证明。
- 原 cp3 的 14 条越界引用已在 S05 授权内 resolved；[pre-fix/static-audit.json](evidence/pre-fix/static-audit.json) 保留原证据，不用全绿 npm 门禁替代静态合同检查。
