# 取证资料与使用范围

检索日期：2026-10-01。本轮资料用于架构规划，不替代宿主实际版本的能力核验。

## 项目当前状态

- EvoFence checkout：`d47f88367564e65db026b43b4b1e4fd83f06a4b7`。
- 本地package/CHANGELOG：0.4.2。未查询npm registry，未做远端发布状态断言。
- 关键源码：`src/index.ts`，`src/lib/exec/runner-{preflight,baseline,iteration,run,evaluate,context}.ts`，`src/lib/gate/index.ts`，`src/lib/ledger/driver.ts`，`src/lib/exec/adapter-args.ts`，`src/lib/config/schema.ts`，`src/lib/gate/dead-keys.ts`，`integrations/deepseek-harness/index.js`，`integrations/pi/evofence.js`。
- 旧图只读来源：`${USER_HOME}/EvoFence/.graph/{evofence-ts-refactor,evofence-ops-evidence,evofence-042-hardening}`；历史软删理由见REVIEW。

## Super Plumber

- 本机安装：`@lukawi/super-plumber` 1.0.0；CLI来自全局npm。
- 本机克隆：`${USER_HOME}/super-plumber`，commit `acdc506932d8a6d0d2a1c1ba4bb1ea63090f8844`。
- 已核对CLI help、installed `integrations/src/manual.md`、`plumber-design`/相关attachments、类型/schema和设计doctor脚本；只读查看clone产品文档、paper中机制/局限与scheduler源文件。paper中的外部效果论述未作为EvoFence收益证据。
- [官方仓库](https://github.com/LUKAWI/super-plumber)：工作/知识顶点、类型边、状态/门禁、领域context、ADR、跨域契约、图预览和导出。
- Context7查询Super Plumber只返回同名但不相关项目，未引用这些匹配；采用本机包和官方仓库。

本提案的SPBridge是未来可选实现，不存在当前core依赖或完整运行图可无损转换的承诺。特别注意`review`只是记录/提示，`iterates`主要为标注，不能直接当产品的授权或有界循环执行器。

## Graph Engineering

- [LangChain作者的Graph Engineering论述](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph)：节点可包含完整agent、运行图有循环与动态分支；用于校准术语，不代表选用LangGraph。
- 用户通过Q10确认“任务驱动的动态子图＋可复用模板”。这是本提案的产品决策依据。

## DeepSeek Harness

Context7已先resolve到官方`/deepseek-ai/deepseek-harness`，再查询原生接入、团队、权限、会话投影、usage、取消与恢复。引用来源：

- [extension cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md)：`tools/pre-execute`权限钩子。
- [agent-team subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/agent-team.md)：membership、teammate、任务与中断服务。
- [Agent runtime types](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/src/runtime-types.ts)：cancel与live-agent相关接口。
- [agent instructions实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/src/index.ts)：agent/pre-step与tools/result接入实例。
- [session projection实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-projection/src/index.ts)：版本投影与恢复。
- [workflow subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.zh.md)：workflow agent start/end与取消路径。

以上是master的资料，不宣称本机DSH已经运行这些接口。仓库已有integration peer指向`0.1.7-rc.1`；L1必须固定实际目标版本并逐项验证。

## Pi

Context7已先resolve到官方`/earendil-works/pi`，再查询SDK/extension lifecycle、上下文、tools、persist、usage与delegation。引用来源：

- [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)：pi.on、tool hooks、context与appendEntry。
- [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)：AgentSession及其创建/管理。
- [AgentSession实现](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)：agent_end和后续settled语义。
- [JSON lifecycle](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)：agent/turn/message/tool事件。
- [RPC统计文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)：session usage统计，作为来源核查线索；产品主路径仍为原生接入。

以上main可能与当前EvoFence文档固定的v0.87.1不同。Context7当前也列v0.99.0，但本轮未选择/安装目标版本。子agent不按第三方extension的功能假定为Pi内置；L1必须核查SDK child执行与权限/恢复语义。

## 证据等级

| 等级 | 本轮状态 |
|---|---|
| 用户产品方向 | 已交互确认 |
| 现有源码与本机SP能力 | 已只读取证并实际使用graph CLI建图 |
| 当前官方DSH/Pi API文档 | 已经Context7检索，部分官方页面复核 |
| 目标版本接入conformance | 未执行，已规划L1探针 |
| 新runtime与双宿主真实任务 | 未实现，已规划L2/L3 |
| 未见任务能力收益 | 未试验，已规划L4 |

历史能力优先原则用于规划参考；本轮已通过Q9重新确认，不用旧版本/测试数推断当前功能或收益。
