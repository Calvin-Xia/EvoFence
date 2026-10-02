# l3-pi-scenario → orchestrator

- lane cwd：`C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-pi-scenario`，branch `refactor/hk-l3-pi-scenario`，HEAD `5ec65f13424da1105e8e19dd8ded78b7b77da6a0`。没有 commit；lane 仅 `scenarios/pi/**` 新增。
- 冻结合同只读，SHA-256 见 REPORT；没有写集成目录、core、`.graph`、依赖或 credentials。
- **cp1/cp2/cp3 passed**：provider-live 成功 attempt 2，独立 audit 与最终代码的两轮 7/7、四门禁全 0。阅 `REPORT.md`、`evidence/attempt-2/audit.json`、`index.json`；原始数据全部仍在本地。
- scratch：`C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-pi-scratch`，detach 于 5ec65f1，本地 no-hardlinks clone + node_modules junction。最终 dirty 只为 catalog.ts、handlers/context.ts、handlers/ledger.ts、test/ledger-limit-scenario.test.js、docs/cli-limit-scenario.md。patch/byte hashes 在成功 evidence 内，不要把实验任务功能并入产品分支。
- 累计 **84 requests / 2,047,716 tokens / $0.24026418 参考非账单**；第一尝试 30、成功含质量收口 54。84 条 raw provider usage 完整；所有费用含失败/续跑/验证。本地 MODEL-BUDGET 从 inherited ledger 保留旧行后追加；合并仅追加 scenario rows，不能覆盖并发 lane 的预算。
- 第一尝试有 kernel unknown integration 原样保留；不能把它标 passed。第二尝试是独立重跑，其内部自己的 abort/reopen 同一个 session。两次实际支出都统计；负结果见 REPORT。
- Pi host source **0 改动**；lane 驱动使用现有 binding/delegation/child/shared meter，以及生产 graph patch/scheduler/session。Pi SDK 并行 factory 属 native session 能力 + adapter 接线，不称 native board。DSH 功能差异表是静态对照，其 live 结果需合并另一个 lane。
- 关键命令及结果：`node scenarios/pi/run.mjs --new-attempt=2 --restart-preflight` 0；`node scenarios/pi/quality.mjs --new-attempt=2` 0；`node scenarios/pi/audit.mjs --new-attempt=2` 0。`--restart-preflight` 只因同一 attempt 的无付费 preflight CRLF stat 误报使用，源码 diff 为零；不能用于重跑付费阶段。
- 没有后台 agent/model 进程残留：驱动结束前已 await settlement、close delegation、dispose parent/children；scratch 和证据保留。
- 下一动作：独立读取 audit/patch/trace 与预算，确认 scope 后复制 `scenarios/pi/**`（generated evidence/预算 gitignored 但本地必须保留）、做 orchestrator 图 checkpoint→report→verdict。不要移植或覆盖冻结合同；不要把初次未知回执翻绿；不声明收益。
