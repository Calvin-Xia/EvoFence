lane: kernel-verification

cp1: passed — [ordinary/repair/delegation 轨迹](evidence/repeatability.json)；`node verification/kernel/run.mjs` 实测普通任务完整纵向闭环，动态 delegate 请求和验证失败修复均通过。

cp2: passed — [故障轨迹索引](evidence/repeatability.json)；并发 claim/fencing、取消未确认、超预算、commit 前/后及 host ack 前崩溃恢复、unknown reconcile、旧 epoch 与过期 lease 全通过。

cp3: passed — [DRIFT.md（resolved）](DRIFT.md) / [static-audit.json](evidence/static-audit.json)；`node verification/kernel/static-audit.mjs` exit 0、status passed、0 violations，79 modules/318 import-export entries。原 runtime → storage 的 14 条越界 import 按 S05 改为 kernel；冻结 I01/R1 和 allowlist 未变；唯一 policy/graph/scheduler/facts 入口仍接线，无扫描到的 NOT WIRED/直接影子判定调用。

错误矩阵: [ERROR-MATRIX.md](ERROR-MATRIX.md) / [error-matrix.json](evidence/error-matrix.json)（17 条；实际码均属于冻结 58 个 ERROR_CODES）。

轨迹可复现性: [command-repeatability.json](evidence/command-repeatability.json)；12 条轨迹各两次逐字节一致，且 evidence/repeatability.json 与保存的修复前文件逐字节相同（文件摘要 `sha256:fb55466caa617b70a679808f229f499f73835d03116014dc99cb906687c8fb6f`）。整条入口两次 exit 0/stdout 一致（`sha256:8dcfd6e950980a36cef58903b238198cb43835c101d2ba68898f7bf0002c669f`）；与旧 stdout 相比仅末行 cp3 failed/14 → passed/0，逐条轨迹行未变。

门禁: [gates/results.json](evidence/gates/results.json)；build/typecheck/src:policy/dep:check 均 exit 0；src:policy 191 TS/最大 350 行/0 JS；dep:check 191 modules/706 edges/0 cycles；`npm test` tests 814/pass 814/fail 0/cancelled 0，与修复前数量完全相同，其中原 lane 新增 12 个实际标题仍在日志；[7 个变异](evidence/mutations/results.json) 各 green 0/1 → red 1/1 → restored 0/1，未做变异源码/磁盘 dist 写入。

移动/新增/修改文件清单: [MIGRATION.md](MIGRATION.md)；12 个纯模块搬迁、1 个 core barrel 新建、19 个既有文件仅改 import/export 来源（runtime 9/backend+barrel 5/测试 5）。[relocation-verification.json](evidence/relocation-verification.json) 实测 31 个既有文件除来源路径之外字节相同；SessionPorts、函数体、签名和测试断言完全保留。verification 新增搬迁/比对脚本，更新 mutation 路径及取证脚本、报告与 evidence。

受影响节点证据路径: l2_state_store → relocation-verification.json + gates/test.stdout.txt；l2_artifact_port → 同上（8 个模块、5 个测试）；l2_runtime → static-audit.json + repeatability.json；l2_kernel_verification → summary.json + command-repeatability.json + mutations/results.json + gates/results.json。全部相对 evidence/；其余上游来源文件未改，既有测试仍包含在 814/814 门禁中。

未证明项: 真实 Pi/DSH 双宿主闭环与真实 child lifetime/usage/activation 仍归 L3；内存 store 的 JSON 恢复不证明 OS crash 耐久性；SnapshotStore 与观察 logger 由 verification 显式使用，未声称应用服务已有 LoggerPort/snapshot 接线；不证明动态 GraphPatch 提交、发布 core export 闭包、任意反射的完整 provenance、OS sandbox 或能力收益。

阻塞: 无。S05 授权的 I01 drift 已 resolved；未改 frozen allowlist/OWNERSHIP/协议/ledger/schema，不操作 .graph，不 install，不 commit，HEAD 不变。所有产品来源修改均属搬迁或 import/export 来源重写；范围证据见 scope-check.json。残余风险是上列真实宿主、耐久 backend、反射完整证明和发布闭包未核实，不属于本次纯搬迁的新增行为差异。
