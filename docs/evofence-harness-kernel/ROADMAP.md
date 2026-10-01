# 重构实施节点索引

由当前设计生成；节点、状态与依赖真相源是 super-plumber 图。所有节点尚未实施。level 表示阶段，不是依赖深度。

## L1 · 目标、双宿主探针与契约定案

| 节点 | 归属 | 产出 | 前置 | 建议独占模块 |
|---|---|---|---|---|
| l1_review | ctx_contract | 人审目标、范围与研究计划 | 人审起点 | design/charter |
| l1_dsh_probe | ctx_host | DSH 原生会话与团队能力探针 | l1_review | probes/dsh |
| l1_pi_probe | ctx_host | Pi 原生扩展与委派能力探针 | l1_review | probes/pi |
| l1_graph_contract | ctx_graph | 动态图与有界 loop 语义规格 | l1_review | spec/graph |
| l1_eval_protocol | ctx_eval | 冻结实用场景和收益评测协议 | l1_review | spec/evaluation |
| l1_api_freeze | ctx_contract | 双宿主公共协议与边界定案 | l1_dsh_probe, l1_pi_probe, l1_graph_contract, l1_eval_protocol | spec/contracts |
| l1_replan | ctx_contract | 研究毕业与实现图增量人审 | l1_api_freeze | design/review |

## L2 · 宿主无关内核

| 节点 | 归属 | 产出 | 前置 | 建议独占模块 |
|---|---|---|---|---|
| l2_public_contracts | ctx_contract | 实现无副作用协议层 | l1_replan | packages/protocol |
| l2_state_store | ctx_store | 执行 journal、投影和 outbox | l2_public_contracts | packages/storage |
| l2_graph_model | ctx_graph | 图编译器与原子修订 | l2_public_contracts | packages/kernel/graph |
| l2_policy | ctx_policy | 授权、观测与总预算服务 | l2_public_contracts | packages/kernel/policy |
| l2_host_port | ctx_runtime | 宿主 ports 与委托协议 | l2_public_contracts | packages/runtime/host-port |
| l2_artifact_port | ctx_store | 不可变产物与验证引用 | l2_state_store | packages/storage/artifacts |
| l2_scheduler | ctx_graph | 租约、资源冲突与公平调度 | l2_graph_model, l2_policy, l2_state_store | packages/kernel/scheduler |
| l2_runtime | ctx_runtime | 会话归约与效果恢复 | l2_scheduler, l2_host_port, l2_artifact_port | packages/runtime/session |
| l2_kernel_verification | ctx_runtime | 内核完整性纵向核验 | l2_runtime | verification/kernel |

## L3 · 双宿主实用纵向闭环

| 节点 | 归属 | 产出 | 前置 | 建议独占模块 |
|---|---|---|---|---|
| l3_dsh_session | ctx_host | DSH 原生会话绑定 | l2_kernel_verification, l1_dsh_probe | packages/hosts/dsh/session |
| l3_dsh_delegation | ctx_host | DSH 团队与子图执行 | l3_dsh_session | packages/hosts/dsh/delegation |
| l3_pi_session | ctx_host | Pi 原生扩展绑定 | l2_kernel_verification, l1_pi_probe | packages/hosts/pi/session |
| l3_pi_delegation | ctx_host | Pi 子会话与子图执行 | l3_pi_session | packages/hosts/pi/delegation |
| l3_context_router | ctx_learning | 节点上下文与反馈路由 | l2_kernel_verification | packages/learning/context |
| l3_workspace_txn | ctx_runtime | 代码与技能产物事务 | l2_kernel_verification | packages/runtime/workspace |
| l3_task_evaluation | ctx_eval | 任务完成的唯一裁决入口 | l2_kernel_verification, l1_eval_protocol | packages/evaluation/task |
| l3_dsh_scenario | ctx_eval | DSH 真实长程协作闭环 | l3_dsh_delegation, l3_context_router, l3_workspace_txn, l3_task_evaluation | scenarios/dsh |
| l3_pi_scenario | ctx_eval | Pi 真实长程协作闭环 | l3_pi_delegation, l3_context_router, l3_workspace_txn, l3_task_evaluation | scenarios/pi |
| l3_dual_host_gate | ctx_eval | 双宿主实用闭环验收 | l3_dsh_scenario, l3_pi_scenario | verification/dual-host |

## L4 · 经过验证的长期演化

| 节点 | 归属 | 产出 | 前置 | 建议独占模块 |
|---|---|---|---|---|
| l4_asset_registry | ctx_learning | 能力资产版本与资格 | l3_context_router, l2_artifact_port | packages/learning/assets |
| l4_experience | ctx_learning | 轨迹提炼与候选生成 | l4_asset_registry, l3_dual_host_gate | packages/learning/proposals |
| l4_retrieval | ctx_learning | 适用经验检索与注入 | l4_asset_registry, l3_context_router | packages/learning/retrieval |
| l4_evolution_eval | ctx_eval | 候选与长期能力独立评价 | l3_task_evaluation, l1_eval_protocol, l4_asset_registry | packages/evaluation/evolution |
| l4_promotion | ctx_learning | 验证晋升与宿主激活事务 | l4_experience, l4_evolution_eval, l3_workspace_txn | packages/learning/promotion |
| l4_regression_revocation | ctx_eval | 退化检测与撤销传播 | l4_promotion, l4_retrieval | packages/evaluation/revocation |
| l4_learning_scenario | ctx_eval | 跨任务学习与可撤销演化场景 | l4_promotion, l4_retrieval, l4_regression_revocation, l3_dual_host_gate | scenarios/learning |
| l4_capability_trial | ctx_eval | 受控能力收益与消融试验 | l4_learning_scenario, l1_eval_protocol | experiments/capability |

## L5 · SDK、观测、迁移与交付验收

| 节点 | 归属 | 产出 | 前置 | 建议独占模块 |
|---|---|---|---|---|
| l5_public_sdk | ctx_surface | SDK 消费面与最小嵌入示例 | l3_dual_host_gate, l4_promotion | packages/sdk |
| l5_cli_observability | ctx_surface | 薄 CLI 与原生观测视图 | l5_public_sdk, l4_regression_revocation | packages/surfaces |
| l5_sp_bridge | ctx_surface | super-plumber 可选互操作 | l2_graph_model, l5_public_sdk | packages/bridges/super-plumber |
| l5_legacy_boundary | ctx_store | 旧格式只读边界与 breaking 指南 | l2_state_store, l4_asset_registry | packages/storage/legacy |
| l5_release_plan | ctx_surface | 打包与交付边界核验 | l5_cli_observability, l5_sp_bridge, l5_legacy_boundary, l4_capability_trial | delivery/package |
| l5_accept | ctx_eval | 最终人审与目标验收 | l5_release_plan | verification/acceptance |

