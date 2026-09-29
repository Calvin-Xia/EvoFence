# DECISIONS

> 决议一行索引（由 `graph export` 从图顶点生成）：passed 的 task 节点 + accepted/superseded 的 ADR。
> 图为真相源，本文件是视图；改图不改文，重新导出即覆盖。

| 决议 | id | 标题 | 结论时间 |
|------|----|------|---------|
| ADR · accepted | adr_0001 | max_usd 支持面扩展到 Pi，语义为事后累计而非原生上限 | 2026-09-29T04:24:15.192Z |
| ADR · accepted | adr_0002 | 导出 bundle 的离线校验复用冻结的哈希链配方 | 2026-09-29T04:24:15.629Z |
| ADR · accepted | adr_0003 | doctor 只呈现既有判定，不引入新校验 | 2026-09-29T04:24:16.011Z |
| ADR · accepted | adr_0004 | 配置面文档以 schema 为单一真相并由机器守卫 | 2026-09-29T04:24:16.388Z |
| task · passed | l1_freeze_files | 文件所有权与冲突规避规则 | 2026-09-29T04:44:40.444Z |
| task · passed | l1_freeze_iface | 命令面与语义接口冻结 | 2026-09-29T04:34:44.761Z |
| task · passed | l2_bundle_cmd | ledger verify --bundle 命令面与文档 | 2026-09-29T05:20:13.981Z |
| task · passed | l2_bundle_core | 离线复算链并与 integrity 比对 | 2026-09-29T05:04:24.425Z |
| task · passed | l2_bundle_negative | 篡改截断乱序负向用例 | 2026-09-29T05:11:50.276Z |
| task · passed | l2_cfg_ci | CI 与 npm script 接入 | 2026-09-29T05:18:35.587Z |
| task · passed | l2_cfg_compare | 与 docs/config.md 比对并可定位差异 | 2026-09-29T05:12:52.195Z |
| task · passed | l2_cfg_solve | 从 schema 求解 required 与默认值与失败码 | 2026-09-29T04:54:20.805Z |
| task · passed | l2_doctor_align | doctor 复用既有判定并对齐错误码 | 2026-09-29T05:53:42.477Z |
| task · passed | l2_doctor_cmd | doctor 命令面接入 | 2026-09-29T04:52:48.390Z |
| task · passed | l2_doctor_proof | doctor 只读性与交叉断言加文档 | 2026-09-29T05:22:28.482Z |
| task · passed | l2_usd_accounting | 记账与阈值终止路径含账本事件 | 2026-09-29T05:20:14.924Z |
| task · passed | l2_usd_adapter | 放行 Pi 并按适配器改写错误文案 | 2026-09-29T05:12:03.118Z |
| task · passed | l2_usd_docs | 语义文档与 CHANGELOG 同步 | 2026-09-29T05:24:22.659Z |
| task · passed | l3_conflict_audit | 共享文件 hunk 与 catalog 合并性核对 | 2026-09-29T05:36:19.250Z |
| task · passed | l3_gate_matrix | 逐分支门禁实测 | 2026-09-29T05:36:18.455Z |
| task · passed | l3_pr_deliver | 推送分支并开 PR 至 CI 全绿 | 2026-09-29T06:13:03.137Z |
| task · passed | l3_review_convention | 惯例轴复核 | 2026-09-29T06:08:26.005Z |
| task · passed | l3_review_disposition | 复核意见处置 | 2026-09-29T06:09:33.358Z |
| task · passed | l3_review_spec | 规格轴复核 | 2026-09-29T06:05:56.351Z |
| task · passed | l3_trace_matrix | 派单四方对应表 | 2026-09-29T05:36:20.024Z |
| task · passed | l4_criteria_audit | 验收标准逐条核对与遗留项汇总 | 2026-09-29T06:20:00.073Z |
| task · passed | l4_docs_behavior | 文档与行为一致性 | 2026-09-29T06:17:19.435Z |
| task · passed | l4_export | 领域视图导出与漂移核对 | 2026-09-29T06:18:20.077Z |
| task · passed | l4_frozen_audit | 冻结过程记录零改动 | 2026-09-29T06:17:20.291Z |
| task · passed | l5_accept_artifacts | artifacts 存在性与内容抽查 | 2026-09-29T06:20:42.315Z |
| task · passed | l5_accept_matrix | 成功标准逐条验收 | 2026-09-29T06:20:40.139Z |
| task · passed | l5_accept_verdict | verdict 落账 | 2026-09-29T06:20:49.964Z |
