# 真人定案输入（Human Review Inputs）

状态：**冻结提案 l1-freeze.2；H01–H13全为pending**。本版随 SCHEMAS.md 变更记录（`l1-freeze.1`→`l1-freeze.2`：`SessionView` 增必填 `nodeStates`／新对象 `NodeStateEntry`；`DecisionRecord` 按 `kind` 约束各 receipt ref；`CapabilityJudgement` 增护栏字段）对齐 lane 版本与 schemaVersion `1.1.0`，H01 的 schemaVersion 立场已同步。这是下游 `l1_replan` requires_human 门的审阅包，不是本节点的批准、ADR accepted 或试验授权。本节点没有签署人、时间戳、approvalRef或代签结论。

## 1. 决策总表

| ID | 真人须选择的实质事项 | 本轮提案立场 | 未定案时边界 |
|---|---|---|---|
| H01 | 是否批准新版namespace/codec、轻量core、单journal/四权威和major规则，并由图owner另处理proposed ADR | runtime/1 + assets/1 + schemaVersion1.1.0（1.0.0 保留为可读 codec）；I01–I08/A01–A15；共同kernel路线 | 仅供实现/审阅，不能当已发布API或运行conformance |
| H02 | DSH integration跟随0.2.0-rc.2升级并重测，还是明确保持不兼容 | 当前旧plugin声明不匹配；目标始终本机0.2.0-rc.2 | 旧integration不准入；本节点不改包/不重装/不回滚 |
| H03 | DSH新增真实provider/child/usage/activation/用户资源共存取证的条件、范围与额度类别 | 先原生fixture，真实保证单独升证据；缺值不借Pi | provider-live要求unsupported；生产覆盖unknown |
| H04 | 比较只需payload high被接受，还是必须服务端独立reasoning档位 | 两者分别表达；不宣称独立high成立 | server-tier hard两侧unsupported；payload-only须明确任务/比较条件 |
| H05 | 可靠协调采用共享journal/outbox+目标消费ack，还是等待native消息保证 | 默认共同kernel ack路线，先取证再准入 | DSH队列成功不算送达；可靠消息要求unsupported |
| H06 | 本阶段同用户信任域是否可接受，哪些任务必须OS sandbox | scope/trustDomain显式，OS hard不降格 | DSH unknown / Pi raw absent；有OS要求不执行 |
| H07 | host board仅投影还是另立显式subtree authority协议 | 本提案仅投影（A15）；子执行委托不移交claim/裁决 | 不启用board独立owner；未来移交需新明确协议/版本 |
| H08 | T0评测模型/语料/工具/功效方案、控制试验与judging额度及签署 | 保持v3唯一有序判定；L4额度仍未授权 | 不发受控试验请求、不宣称收益/T0 |
| H09 | 可选EventStore backend及需持久性的准入profile | memory用于smoke；耐久backend须原子故障conformance | 原生resume/JSONL不能当kernel journal恢复 |
| H10 | 资产train/dev来源冲突、上游陈旧占位和文档优先级如何由owner统一 | train-only；本lane登记当前pin及差异，不改上游 | 不用dev生成受控试验资产、不填T0/改Q条目 |
| H11 | 费用取整与精确包络如何修订后冻结T0 | 每请求ceil微美元，拒绝不自洽包络 | S1/2/3表近似额不直接授派发额度 |
| H12 | DSH 是否必须具备 Pi `appendEntry`/custom-entry 等价语义，或允许只用同 journal 的自有 seam | DSH `sessionCustomEntries` 保持 unknown，不假定有或没有；binding/receipt 不依赖宿主 custom entry | 需要宿主 appendEntry 保证的任务标 unsupported；Pi-only 语义不进公共合同必填 |
| H13 | 父子 cancel 级联与运行中工具取消是否作为 task hard，及取证范围 | DSH `parentChildCancellation`/`toolCancellation` 均 unknown；cancel 未确认保持 unknown，不写 cancelled | 要求级联为 hard 的任务在两宿主标 unsupported |

H01是提案定案，H02–H13为其范围/后续实现/试验政策选择。技术保证必须通过conformance，不因真人批准而提升unknown/partial为verified。

## 2. 每项依据、替代代价与审批范围

### H01 — 版本与可导入内核

依据：CONTRACTS §2/§5/§9，proposed adr_0001/0004/0006/0009/0010；新namespace原草案仅举例。选择本提案使codec明确、旧格式保留而不执行、核心无CLI/Git/SQLite/SP强依赖；代价是新kernel/ports/reducer及两个adapter的实现与同suite核验，不是沿用原ledger资格。另一选择须改本提案版本与对应schema，不能“保留同名但改语义”。

签署须绑定七份合同hash、源pins、所有权与开放项处置；ADR状态由graph owner走图流程，本文件不能代替。技术证据仍待L2/L3。

### H02 — DSH旧integration缺口与历史drift

依据：[HOST-MAPPING](HOST-MAPPING.md) DV/D16（existingIntegrationCompatibility:unknown，VERSION-PIN /integrationGap）；当前固定@deepseek-ai/dsh@0.2.0-rc.2，integration peer/engines仍为0.1.7-rc.1精确声明。选择升级需另授权integration owner修改、编译/真实兼容重测及新pin；选择暂保留需显式“不兼容当前DSH”，仅可使用新的目标版本adapter路线。不能以原生probe通过证明旧plugin可用。

历史外部升级归因是orchestrator报告。原npm日志在采集前已缺失/据报告轮转，drift.evidence=[]、verificationStatus=unverified、changeTime=null；reportedChange保留会话报告。真人可接受“有报告但此artifact无原始证据”，不能重建伪原文或写已核对精确时间。本节点不安装、不回滚。

### H03 — DSH实时及生命周期证据

依据D1–D8/D14/D17是native-fixture，DSH /live-trace为not-run、paidRequests=0；Pi P1/P2/P4/P5/P14/P17有两次真实付费请求。status相同不表示同证据等级；DSH失败/取消usage为空，真实供应商/model/price未成立。

后续可选：①先只允许fixture/development smoke，真实任务保证unknown；②对固定provider/model/payload/工具/child/retry/取消/idle等分别设有限取证计划与相应授权，保留raw usage和失败路径。需真人明确新增scope、所需证据种类/覆盖、预算类别和额度；不能挪用旧0.50探针额度或将Pi两请求推广到DSH。实际activation、真实Skills/插件共存另取证，不凭controlled markers当全用户资源共存。代价为真实调用费用、安装版本固定与覆盖测试；本节点不执行。

### H04 — reasoning档位与可比性

依据D14 reasoningHighGuarantee:unknown；P14:partial、真实payload接受但没有独立服务端high档位证明。选择payload-only须把task ModelRequirement.reasoningGuarantee写payload-only且任务/比较双方payload固定，服务端不明仍披露；选择server-tier则requirement hard，仅独立证据可准入，当前两侧unsupported。

降级只在task声明degradable、替代能力独立verified且approval绑定时可选。批准“按payload条件比较”不把P14改verified、不覆盖model/backend差异。代价为比较解释范围变窄，或追加独立取证/另选可验证模型。

### H05 — 可靠消息

依据D10 teamMessageDelivery:unknown，/checks/teamMessageDurable=false；queued不等于目标消费ack；Pi此键未声明，按unknown。方案①共享journal/outbox、目标消费ack、内容摘要+去重/序号/epoch、超时核实；两host同一协议。方案②原生提供真实持久投递和目标ack再取证。两者当前都没有完整kernel保证。

共享路线代价是存储I/O、消费确认、故障恢复与延迟；不承诺外部exactly-once。真人须决定可靠消息是否task hard、可以批准哪些替代/成本。尚未实现的新路线不能作为已满足要求，原消息失败不抹去。

### H06 — OS隔离

依据D15 osSandbox:unknown；P15 raw absent（未添加/测试OSsandbox），D3/P3只有工具请求拒绝fixture；scope写范围强制DSH D13 unknown。hooks/worktree/child transcript不证明OS隔离。

可选①同用户信任域任务，权限只主张内核请求路径约束，披露越过插件的写入/外部动作没有检测保证；②注入外部OS隔离Workspace/Host实现并取证后满足hard。真人批准同用户风险属于明确降级、限定task/scope/capabilities，不能改OS状态。代价为信任边界变化，或外部sandbox工程与运行费用。

### H07 — 调度authority与board

依据D11 caller identity verified、D12 native board CAS verified、D9原生投影序号verified；P12 native board absent。这些不证明kernel claim/权限/裁决。本提案board仅投影（A15），owner始终journal唯一；D8/P8允许有限child执行原语，不自动授予subtree调度authority。

若真人要求宿主subtree owner，须另立原子移交、撤销/恢复、父预算/子grant和互斥owner合同；kernel与board不能同时claim同attempt。改变1.0所有权语义需新版本，不加暗旗。代价是移交协议及故障证明；默认投影的代价是共同kernel调度实现。H07批准不直接实施移交。

### H08 — 评测T0、预算与功效

依据evaluation v3五份文件（均是待T0草案）：provider/model、语料/拆分hash、工具/权限与分析脚本身份尚待签署。默认held-out N=160/臂/host，B−A MVE=.15、C−B=.10，Z_MVE边界1.960、唯一确认看；N/2 CP<.20仅futility→inconclusive，不作疗效结论；每repo一分区、held-out一实例、final只一次。选替代试验设计须保留两host分别可比和实际预算说明。

C−B含futility整体功效79.8%低于80%目标：真人选择取消futility（80.7%条件=整体）或N=165并由分析脚本重算；不能用旧v1/v2边界或补测至显著。质量由臂外独立盲评，judging成本独立全报告，不计处理臂包络；四类裁决仍独立。

开发期deepseek/gpt无美元上限是上游记录的development政策，不等于L4 controlled-experiment授权。0.50 USD为已闭合探针额度；T2约943 USD是**请求额度/设计估算**，不是批准，judging额度须另外明确。真人须批准试验设计/模型/额度/语料及真实T0签署；本节点零新增请求，不能把未获额度写成可以缩小成功标准。

### H09 — 可选耐久backend与恢复profile

依据D7 memory resume verified、D19 diskCrashRecovery unknown；P7 JSONL reopen verified；D20 externalEffectReconciliation unknown / P20 absent；两侧没有kernel journal+atomic outbox/crash完整恢复证据。

可选memory-only development，或可选SQLite/其它耐久实现；后者需CAS+outbox+claims/leases/reservations同事务、崩溃前后故障注入与epoch/sequence核验、unknown核实。代价为backend实现/部署；core import仍不得强依赖native DB。真人决定生产要求和可选backend，技术有效性须L2/L3，不能用probe transcript替代。

### H10 — 资产来源与上游文档漂移

精确冲突：PROTOCOL §2 C说明“train/dev产生的资产”，§4明确C只从train生成，SCENARIOS拆分规则同train-only。本提案采用较严格train-only：dev评价/选型，held-out/final无资产或优化反馈。若真人要dev产资产，需数据协议owner重做拆分/冻结及污染规则，不能暗改候选来源。

另有OPEN-QUESTIONS Q6“DSH未完成”、PREREGISTRATION宿主DSH“待探针”与当前已passed的0.2.0-rc.2 probe时间差；本lane以其当前pin作映射输入，不把T0占位填成已签署。Q19保留CONTRACTS §8阈值/样本尚未决定与评测草案的已知漂移，供owner按授权更新。ARCHITECTURE不在本brief事实输入，本文件只转述Q19的登记，不从它另取事实。代价为owner同步文档并哈希新T0；本节点不改这些源。

### H11 — 微美元取整与精确包络

依据Pi VERSION-PIN /price参考价、PROTOCOL §3/METRICS §7.1–7.2/PREREGISTRATION包络。单请求最坏值：
`60000×0.14/1e6 + 4096×0.28/1e6 = 0.00954688 USD`，ceil到微美元=`9547`。上游表却称逐字段相等。

| 层 | request_cap | 上游表usd_cap（微美元） | 请求数×9547（微美元） | 差：上游−精确 |
|---|---:|---:|---:|---:|
| S1 | 20 | 190900 | 190940 | −40 |
| S2 | 40 | 381900 | 381880 | +20 |
| S3 | 80 | 763800 | 763760 | +40 |

S1不能在最坏用量下兑现20份预留；S2/S3不满足文字“相等”。本提案S08安全条件为request_cap×最坏预留≤cap，S1拒绝；若T0继续要求逐字段相等，三层都需精确对齐。真人可①按9547计算精确cap并重算预算（提案），②保持已有金额并调整request_cap/明确放弃全部最坏请求可达的要求后改协议。不得靠浮点epsilon/四舍五入少预留绕预算。H11改变T0预算须授权，当前表只取证，不改上游数值、不增加可花额度。

### H12 — 会话 custom entry 语义与 transcript seam

依据：DSH HOST-MANIFEST `sessionCustomEntries: unknown`（无 Pi 的 appendEntry 对应证据）；Pi HOST-MANIFEST `sessionCustomEntries: verified`（appendEntry retained after disk reopen）。公共合同的 binding/receipt 走同 journal；D8/P8 只证明 child identity/transcript 分离。选择“不要求 DSH 等价”：需要宿主级 appendEntry 保证的任务标 unsupported；选择“要求等价”：adapter 实现 + 磁盘重开取证后另升证据。代价为 adapter 实现与取证，或部分任务不可执行。自本项起，H03 的“child/取消/idle”清单不再覆盖 custom-entry 语义。

### H13 — 父子取消与工具取消级联

依据：DSH HOST-MANIFEST D18 `parentChildCancellation: unknown`、`toolCancellation: unknown`；probes/dsh README 将“父子取消、运行中工具取消”列为明确适配/取证缺口；Pi 的 cancel 证据只到真实 stream abort，不推出级联。选择“不作为 hard”：A02/A09 的 lease 释放与 unknown 核实不以级联已成立为前提，cancel 未确认记 `EFK_CANCEL_UNCONFIRMED` 并保持 unknown；选择“作为 hard”：两宿主须有真实长流/子成员取消取证与 adapter 实现。代价为 adapter 与取证，或部分任务两宿主均 unsupported。

## 3. 真人门最小输入与签署载体

| 输入 | 完整性要求 |
|---|---|
| 文档与源pins | 七文件实际SHA256；README的23源pins；任何编辑后重新审阅，旧批准不可复用 |
| 处置 | H01–H13逐项 accept-proposal / request-revision / defer / reject，defer明确阻塞范围；不得空白当接受 |
| 真实主体 | 可验证human actor/authority root，时间戳、精确内容/版本/范围/预算引用；不保存凭据本体 |
| approvalRef | 真签署工件的ArtifactRef含digest/schema/visibility；本节点全null，清单本身不是approval |
| 技术资格 | 冻结提案批准后仍须相应L2/L3证据；不能由签字把unknown写verified |
| 图操作 | orchestrator/graph owner记录l1_replan与ADR转移，本lane不得修改.graph或导出views |

未来审阅记录通过受控ArtifactRef进入journal，签署人/时间/结果必须真实。下游收到此包可继续整理可独立的实现计划；依赖被defer/reject的保证与试验不得执行。技术未知、政策待决和额度未授权分别保留，不用“一切blocked”掩盖已完成文档，也不将图节点passed当人审完成。

## 4. 待办（owner 移交，本 lane 不改其他分片）

| # | 待办 | 现状 | 归属 |
|---|---|---|---|
| T01 | HOST-MAPPING 证据索引补齐 `toolCancellation` 与 `providerCancelBilling` | 两键在 DSH HOST-MANIFEST 均为 unknown，但 HOST-MAPPING.md 全文 0 引用（13 个 unknown 只索引了 11 个）；两条已由 H13/本表覆盖为本节点待审项 | HOST-MAPPING owner |
| T02 | SCHEMAS.ErrorCode.enum 与 README 计数/引用同步 | **已闭合**（orchestrator 集成收口实测）：ERRORS 58 码；SCHEMAS.ErrorCode.enum 实测长度 58 且含 `EFK_HOST_BOARD_AUTHORITY_CONFLICT`；OWNERSHIP A01–A15；OPEN-ITEMS H01–H13；README 计数与引用已同步；内嵌 `verify-l1-freeze` 脚本退出码 0（`errorCodes:58, humanItems:13, objectDefinitions:63, requiredFields:423`） | 已闭合 |
| T03 | 版本号对齐 | **已闭合**（orchestrator 集成收口实测）：七份文件头部均为 `l1-freeze.2`；`ProtocolVersion.schemaVersion` 为 `1.1.0`（枚举保留 `1.0.0`）；`evofence.assets/1` 的 assets schemaVersion 独立保持 `1.0.0`（已在 SCHEMAS 与 README 两处写明） | 已闭合 |

