# 0001 — max_usd 支持面扩展到 Pi，语义为事后累计而非原生上限

budgets.max_usd 对 Pi 适配器生效，采用与 max_tokens 完全相同的事后累计加阈值终止机制；不假装它是请求前的硬上限，也不为 Pi 引入伪造的原生 cap。OpenCode 因 cost_currency 明确为 null 继续拒绝，Codex 因不报告成本继续拒绝。

**Status：** accepted

**Context：** Pi 已按模型价格报告完整 USD 成本估算（cost_complete 为真、cost_currency 为 USD），记账链路（usdToMicros、recordCostUsage、budget.exhausted 事件）已存在且被现有用例覆盖。当前唯一阻碍是 src/lib/adapter.ts 与 src/lib/exec/runner-preflight.ts 的硬拒绝，文档把该限制记为目前只支持 Claude Code。

**Considered Options：** A 保持只支持 Claude 并继续拒绝 Pi，落选：Pi 已具备完整成本数据，拒绝属于无谓的能力缺失；B 为 Pi 引入请求前硬上限，落选：Pi CLI 没有原生 USD cap，伪造一个会违反内核的不估计值规则；C 复用事后累计加阈值终止并显式声明语义，选中；D 一并放行 OpenCode，落选：其 cost_currency 为 null，USD 上限需要臆造币种。

**Why：** 复用既有的记账与阈值终止机制，成本最低且不新增第二套预算真相；语义与 max_tokens 一致，用户已有心智模型可迁移。

**Consequences：** 触发上限的那次响应可能已经越过阈值，与 token 预算同一性质，文档必须写明这不是服务商最终账单；Claude 仍走原生 --max-budget-usd，两条路径的语义差异必须在文档中区分清楚，否则用户会误以为两者都是硬上限。

> 本文由 `graph export` 从图顶点 adr_0001 生成；改图不改文，重新导出即覆盖。
