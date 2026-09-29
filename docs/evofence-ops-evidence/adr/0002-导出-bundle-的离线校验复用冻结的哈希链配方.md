# 0002 — 导出 bundle 的离线校验复用冻结的哈希链配方

ledger verify 新增 --bundle 时，用与在线 verify 完全相同的 eventHash 与 stableStringify 配方对导出事件离线复算，并与 bundle 内记录的 integrity 比对；不新增第二套摘要实现，也不定义独立的校验算法。

**Status：** accepted

**Context：** ledger export 产出的 bundle 已包含事件的 seq、created_at、event_type、run_id、payload_json、previous_hash、event_hash 与当时的 integrity 结论，信息足以离线复算。README 明确指出本地库可被同一 OS 账户的进程整体替换，建议把导出的证据放到独立控制的系统，但此前没有任何命令能校验一份导出物。

**Considered Options：** A 为 bundle 定义独立的校验格式与算法，落选：两套配方必然漂移，且违背链配方冻结的约束；B 复用 chain.ts 的配方只更换数据源，选中；C 导出时只记录摘要、校验时仅比总数，落选：无法定位篡改到具体事件。

**Why：** 单一配方是哈希链可信的前提；复用让在线与离线校验的结论必然一致，使导出证据可被第三方独立校验这件事真正成立。

**Consequences：** bundle 形状由此成为对外契约，schema_version 变化必须显式处理而不能静默按当前形状解析；chain.ts 的配方从此被在线与离线两条路径双向锁定，任何改动都会同时被两侧测试拦下。

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。
