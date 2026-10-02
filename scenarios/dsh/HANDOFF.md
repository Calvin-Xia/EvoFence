# l3-dsh-scenario → orchestrator

当前 lane：`C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-dsh-scenario`，分支 `refactor/hk-l3-dsh-scenario`，lane HEAD **b574b1c35b8cd4af31d22df51fe00270afffa4ad**。仅 `scenarios/dsh/**` 为本 lane 未提交新增。没有 lane commit、图修改、宿主源码接线变更或发布。

**cp1 / cp2 / cp3 均 passed**；见 REPORT.md 与 `evidence/audit.json`。图 checkpoint/verdict/status 请由 orchestrator 复核后记录；本 lane 不写 `.graph`。任务与协作通过不等于能力收益。

首要复核入口：

- `node scenarios/dsh/audit.mjs --evidence-only`：不发模型请求，复核现存原始证据。它要求当前集成点 clean；若别的工作让集成点 dirty，写明 cp3 failed，不清理那些文件。
- `evidence/trace.jsonl`、`runtime/sessions/**/session.v4.jsonl`：原生 create/result/cancel/reopen/continue 的实际序列。
- `evidence/negative-control.json`、`check-2.json`、`test-quality-repair.json`、`check-4/5.json`：真实 mutation 红 → byte restore → 两轮绿，区分另外两例的真实测试语法错误。
- `evidence/shared-file-conflict.json`、`final-board.json`：双方同文件提案、唯一 writer 的依据与结果，以及最终 kernel claims/native owners 均 0。
- `evidence/kernel-journal.json`：finish succeeded；故障 verify 仍 failed；没有未收口的 scenario claim。
- `evidence/scratch.patch` / `artifact-hashes.json`：5 个真实任务文件完整产物。

scratch `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-dsh-scratch` 使用派单 commit b574b1c，本地 clone + node_modules junction；5 个任务文件暂存，未 commit。保留，不能覆盖或清理。与 Pi 冻结合同 SHA-256 相同，但 Pi 基线是 5ec65f1；如以后做收益实验，应另冻结匹配基线与资源，不能拿本轮次数/费用当提升。

模型使用 DSH 原保存 binding `deepseek-official/deepseek-flash high`，无美元上限，逐请求账本不重置。总 **75 requests / 1,684,159 tokens / $0.14603358 reference（非账单）**。71 条 raw provider usage；4 条旧采集 unknown 由真实 native receipt 提供 normalized usage，原负结果仍保留。accounted unknown usage=0；invoice、Codex 订阅费用 unknown。并入全局预算时按唯一 request ID **追加**本 lane 行，不整文件覆盖其他 lane。

后台进程：本 lane 已结束全部拥有的原生上下文/handles，没有仍运行的场景 worker 或 model request。暂存/证据原文件均留存。首轮旧会话未再次发送外部，第二父会话内的 native cancellation/reopen 通过；不要把这两种事实混为一谈。

剩余边界：生产 DSH binding 多请求 E2E、crash/process-kill、provider cancel billing、服务器 high 语义、账单、OS sandbox、held-out 收益均未证明。最终驱动已经按实际错误修复，并由现存证据审计，**未额外付费从零再跑整套**。若复跑，遵循 README，使用新的独立 evidence 名称与空 scratch，保留本账本与旧产物。
