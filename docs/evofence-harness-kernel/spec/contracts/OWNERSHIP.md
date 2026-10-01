# 模块所有权与权威判据（Ownership and Authority）

状态：**冻结提案 l1-freeze.2，待真人定案**；proposed ADR 仍未 accepted。本版随 SCHEMAS.md 变更记录（`l1-freeze.1`→`l1-freeze.2`：`SessionView` 增必填 `nodeStates`／新对象 `NodeStateEntry`；`DecisionRecord` 按 `kind` 约束各 receipt ref；`CapabilityJudgement` 增护栏字段）对齐 lane 版本与 schemaVersion `1.1.0`；本文件的所有权/边界判据不由该变更改写。下列是设计约束及 L2/L3 必须证明的验收判据，不能把静态设计等同运行证明。

## 1. 模块边界

命名为未来模块/导出槽位，不表示本节点创建了文件、package exports 或发布包。核心入口 `evofence/core` 仅包含 protocol/kernel/runtime；基础设施经依赖注入（Dependency Injection）进入。原有 src/、CLI、integration 均未改。

| 模块 / 槽位 | 唯一拥有 | 可引用 | 不拥有 |
|---|---|---|---|
| protocol | schema/DTO/枚举/codec定义 | 自身 | host SDK、I/O、裁决状态 |
| kernel | 纯 reducer、图校验、状态转移、决策归约、能力协商、预算/权限判定规则 | protocol、自身 | 进程/模型执行、数据库、时钟发现、凭据 |
| runtime / evofence/core | KernelService、port接口、调用编排；把纯计划原子提交 | protocol、kernel、自身 | 具体backend/host导入、第二持久真相 |
| host/dsh | 固定0.2.0-rc.2原生hooks/agent/team投影、真实回执规范化 | core公共合同、DSH目标SDK | 任务裁决、kernel claim真相、权限扩大 |
| host/pi | 固定0.87.1 extension/SDK child/usage/settled规范化 | core公共合同、Pi目标SDK | 同上 |
| storage/memory | 开发期EventStore/ArtifactStore实现 | core公共合同 | crash durability声明 |
| storage/sqlite（可选） | 原子journal/outbox/claims/leases/budget backend | core公共合同、其选定DB依赖 | model/tool执行；必须独立conformance后准入 |
| workspace/local（可选） | 实际范围核验、diff/write、串行workspace writer | core公共合同、本地FS/Git实现 | acceptance、OS sandbox声明 |
| evaluator | 私有验收/独立收益分析流水线的真实证据 | core公共合同、冻结评测协议 | 候选作者权威、宿主执行调度权 |
| assets | staging/资格索引/依赖失效/host snapshot适配 | core公共合同、授权stores | 自动晋升/全局active、修改既有全局Skills |
| surface/cli（可选） | 命令封装、错误/视图显示 | core公共合同、可选后端 | 自行判定第二套TaskDecision/错误码 |
| bridge/super-plumber（可选） | 只读外部图输入/导出桥接 | core公共合同、bridge专属依赖 | 运行必需依赖、内核truth；本节点不动.graph |

Host SDK 被 host 模块引用不使 core 可以反向引用；backend被 runtime实例注入不进入core的静态import闭包。可选backend不默认启动，memory模式不借“EventStore”名称承诺持久性。所有注入服务只有调用入口才做外部I/O，createKernel/import均不得执行。

## 2. 可机检的导入规则（Import Boundary Rules）

规则针对未来 core 公共 export 闭包，包含重导出、type-only、静态/动态import、require、模块副作用与打包后的闭包，不只扫描一个入口文本。当前源码未实现此入口，因此本轮没有“core导入检查已通过”的运行结论。

```json
{
  "ruleVersion": "evofence.core-boundary/1",
  "entry": "evofence/core",
  "closureModules": ["protocol", "kernel", "runtime"],
  "allowedEdges": {
    "protocol": ["protocol"],
    "kernel": ["protocol", "kernel"],
    "runtime": ["protocol", "kernel", "runtime"]
  },
  "denyAnyBareImportInClosure": true,
  "denyAnyNodeBuiltinInClosure": true,
  "denyDynamicImport": true,
  "denyRequireAndRequireAliases": true,
  "denyEvalAndFunctionConstructor": true,
  "denyTopLevelExternalIO": true,
  "denyAmbientRead": [
    "process", "fetch", "XMLHttpRequest", "WebSocket",
    "Date.now", "new Date", "performance.now", "Math.random",
    "crypto", "setTimeout", "setInterval"
  ],
  "denyAdapterReExport": true,
  "injectedPortsOnly": [
    "HostPort", "EventStore", "ArtifactStore", "WorkspacePort",
    "EvaluatorPort", "Clock", "PolicyPort", "BudgetPort",
    "AssetRegistry", "DigestPort"
  ]
}
```

| 检查号 | 机检算法/否决条件 | 最小反例 |
|---|---|---|
| I01 | 解析AST并按真实路径解析全部import/export闭包；目标module不在allowedEdges即拒绝；symlink解析后的真实目标也须在闭包 | kernel通过barrel偷偷export host/pi |
| I02 | 拒绝闭包内**所有**bare specifier、node builtin及别名；不得用路径alias伪装外部包 | node:child_process、child_process、node:fs、node:path、node:crypto、better-sqlite3、node:sqlite、simple-git、super-plumber、任一host SDK |
| I03 | 拒绝动态import、require及其alias、eval、Function构造器；无法静态解出目标也拒绝 | import(variable)、createRequire、间接eval |
| I04 | scope-aware AST检查禁用ambient标识及反射访问/别名；类型仅可声明port数据，不捕获process/env/cwd/globalThis | globalThis["fetch"]、const f=Date.now、process.env |
| I05 | 顶层/静态初始化不调用port、不构造backend、不发请求、不打开DB；只允许确定性的值/函数定义与纯schema初始化 | 顶层await ports.store.read() |
| I06 | 构建前后解析导出闭包一致；package root不能把CLI/backend副作用重导入evofence/core | core re-export root而root导入CLI |
| I07 | import/createKernel时注入spy，所有port I/O计数为0；纯reducer/协商重复同输入得到逐字相同结果 | 构造时Clock.now()或自动凭据发现 |
| I08 | runtime的外部能力只能取自参数ports；无默认backend、隐式global单例或fallback网络实现 | missing HostPort时spawn CLI |

不禁止纯确定性 Math/JSON/集合与 Promise 类型；禁止其读取环境或调度外部行为的用法。Clock/随机种子/Digest均显式注入；reducer接收确定值，不在replay中调用会变化的Clock。JSON schema资源在protocol闭包内可作为纯数据，仍不能读取cwd文件。I01–I08是guard实现的明确验收条件；当前只核验此规则文档可解析，guard实现与反例属于L2。I01–I03、I06–I08 是可完全机检的判据；I04、I05 是静态 best-effort：字面量与单层别名可判，需要常量折叠或跨函数纯度推理的写法超出该 guard，此类越权由 I07 的 port spy 在运行期暴露。到期与超时一律在调用点比较 Clock.now() 惰性判定，core 不使用定时器，也不新增 Scheduler port；需要主动定时、重试或取消超时的宿主行为经 HostPort 进出。

## 3. 四个权威域

“权威”（Authority）指某事实的唯一提交/授权资格，不能把host提供事实、store保存事实与evaluator裁决事实混为一个角色。

| 权威域 | 唯一角色 | 输入 → 允许输出 | 不得产生的输出 |
|---|---|---|---|
| 唯一裁决服务（DecisionService） | 同一KernelService内按kind注册的决策归约服务；Task evaluator的测量独立于作者 | 真实证据、精确合同/协议、policy → DecisionRecord，再走journal事务 | root grant、host执行回执、第二份journal |
| 持久真相源（EventStore） | 单一session journal及同事务索引/outbox | 经校验的命令和decision/intention → 连续Event/CAS revision | 自行决定验收通过或执行模型/工具 |
| 宿主执行权（HostPort） | 受grant约束的原生loop/tool/child执行器 | 已提交、当前授权Effect → 实际Receipt/ArtifactRef/Usage | succeeded、promoted、扩权；queued冒充delivered；独立 board owner 或第二调度（board 只投影，A15） |
| 权限根（PermissionRoot，经PolicyPort验证） | 宿主/用户的可信根；其授权及撤销记录进入journal | 可信actor、范围、操作、时效 → Grant交集/拒绝 | TaskDecision、自动扩大任务要求、代签人审 |

一个进程可实现多个port，但角色校验、签发主体和事务入口必须不同；共享函数/进程不赋予另一角色的权威。DecisionRecord.issuer必须是对应决策服务的注册主体；ActivationDecision由内核据HostPort实际ActivationReceipt归约，host不签发第二裁决。EventStore仅按已验证计划提交，未经DecisionService的Event不能把节点标succeeded。PolicyPort可否决执行，不能批准“证据不成立但当作已验证”。

DSH D11（teamAuthorityIdentity verified，exact-live同ID仿造拒绝）仅是原生caller证据，不能当作kernel grant强制；D13 unknown保留。Pi没有该强制能力条目，按missing→unknown。范围交集规则能限制内核请求路径，但same-user外部写入若无有效检测/隔离，不宣称被系统阻断（D15/P15）。

## 4. 权威不重叠的可检验判据

A01–A14 中的 Active 由 journal 和注入时刻/撤销代数确定，不依赖 board 缓存；A15 另外对宿主原生 board 做一次只读枚举，语义仍是“枚举结果必须与 kernel claim 一致”。实现可用SQL/内存索引，但语义相同；每项需正例+否决例。当前状态均为“待L2/L3 conformance”，没有把这些保证填为探针verified。

| 判据 | 可机检条件 | 故障/反例应有结果 |
|---|---|---|
| A01 唯一claim | 对(sessionId,nodeId,attemptId)分组，有效claim数≤1；owner actor必须对应已提交grant；同一node当期attempt不可并发两个owner | 竞争claim仅一CAS成功；另一EFK_CLAIM_CONFLICT |
| A02 排他lease | 按resourceId有效holder≤policy.maxHolders；exclusive=1；每提交匹配当前epoch/fencing | 旧writer无法写当前工件/资产指针；EFK_LEASE_STALE |
| A03 单truth | 每session唯一journal writer/CAS序列；sequence连续、revision每事务+1；board/transcript不能提交状态 | 投影缺sequence拒绝/重建；不从host日志补假事件 |
| A04 outbox原子 | 任何可派发effect均有同CAS事务的intention+claim/grant+所需lease+reservation；任一步失败全部不提交 | 注错commit前派发计数0；commit后恢复只读已提交意图 |
| A05 单裁决 | 改变verifying→succeeded/failed/waiting必须引用当前binding的task DecisionRecord；issuer匹配注册服务 | 伪造host“success”只host.observed或拒绝，节点不成功 |
| A06 单权限根 | Grant.rootAuthorityRef在可信注册表；child.scope/capabilities⊆root∩parent∩task∩node；depth递减；revocationEpoch/time检查 | ID仿造/扩大scope/撤销后请求拒绝；不凭字符串存在授权 |
| A07 单请求计量 | 每requestId同摘要一次结算；每effects隐式/父子请求可追溯到同pool；settled+outstanding≤cap | duplicate不加花费；不同usage拒绝EFK_USAGE_CONFLICT |
| A08 epoch归档 | receipt与当前session/graph/node/attempt/epoch/base相符；提交写效果另核fencing | 迟到receipt存archive不改当前状态/预算、不激活 |
| A09 unknown核实 | 调用图断言：从 core 导出出发不存在到 HostPort.dispatch（非幂等 effect 提交）的可达调用边；resume保持unknown；reconcile提供实际证据 | 断连/崩溃不能盲重放；可达边存在即失败；EFK_EFFECT_NON_IDEMPOTENT_RETRY |
| A10 replay无执行 | 同journal重放同view/outbox未知列表；Host/Workspace/模型/工具/定时器执行计数均0 | 缺schema/epoch/seq停恢复，不用缓存覆盖 |
| A11 汇合不丢证据 | branchReport.nodeIds按集合精确覆盖requiredBranches；每必需分支有binding或显式gapReason | failed/cancelled/missing不能过滤为成功汇合 |
| A12 实际写盘与激活 | writer串行且对应有效lease；newSnapshot仅实际成功回执可提交；失败旧snapshot保留 | DB提交不掩盖workspace/activation失败；unknown先核实 |
| A13 私有反馈 | Event/Decision/Artifact visibility与受众权限一致；调用图断言：执行者可见读取路径不含 final/held-out 工件引用 | secret/held-out/final泄露拒绝EFK_PRIVACY_VIOLATION |
| A14 角色隔离 | adapter/CLI/SP代码不能写DecisionRecord或root grant；核心不能direct执行host I/O或开backend | 静态importguard+伪造actor命令均拒绝 |
| A15 宿主board无第二owner | 对每个 (sessionId,nodeId,attemptId)，宿主原生 board 的 task owner 集合必须 ⊆ {kernel claim 的 owner}；HostPort 枚举到 owner ≠ kernel claim 的原生 task，或枚举到无 kernel 映射的原生 task，即拒绝 | HostPort spy 记录 board create/claim 并枚举原生 task；出现未映射 owner 记 EFK_HOST_BOARD_AUTHORITY_CONFLICT，该 attempt 不推进、原 claim 保留 |

逻辑上：A05将裁决许可限制在DecisionService；A03/A04将持久提交限制在单journal；A04/A06使HostPort只执行被授权意图；A06使所有grant来自同权限根且只缩小；A15把 A01 的单 claim 从 kernel journal 延伸到宿主原生 board——具备原生 board 的宿主（DSH D12）不得对同一 attempt 另立 owner，无原生 board 的宿主（Pi P12 absent）该判据空成立。因此任一角色不能独立授予另一角色事实。实际充分性依赖L2实现、backend原子性与宿主覆盖；A01–A15及I01–I08尚未运行，不能称已有runtime证明。

## 5. DSH board与子图委托

本版（l1-freeze.2）默认选择**board仅投影**：kernel拥有claim与调度truth；DSH board可显示/接收实际状态，不能独立claim同节点或以原生team evaluator取代TaskDecision。D12 verified只证明原生board CAS；D9 verified只证明原生投影序号缺口拒绝。Pi P12 absent不影响不要求原生board的任务，使用同journal view。两侧都没有kernel journal/outbox证据。

“不能独立claim同节点”由 A15 判定，不是配置声明。最小反例：DSH adapter 越过投影路径，直接调用原生 team board 为某 node 建立 owner，而 kernel journal 无对应 claim——A15 在 HostPort 上枚举到该未映射的原生 owner，记 EFK_HOST_BOARD_AUTHORITY_CONFLICT 并拒绝推进该 attempt。

显式child执行委托须有子graph、子grant、唯一owner、父budget、上下文隔离、cancel/lifetime界、真实receipt；kernel仍拥有该attempt的claim和唯一裁决。D8/P8 child identity/transcript成立的范围不推出父子cancel级联（D18 unknown），不推出外部副作用/付费child usage完整。

“让宿主board成为某子图调度authority”的模式本版本**不启用**，留H07人审；若未来启用必须对该subtree原子移交owner、kernel不再独立claim相同工作，并有恢复/撤销/核实合同。一个配置不能同时projection-only与delegated-owner；当前schema没有并行第二权威槽位，不以hidden flag启用。改变既有所有权语义需新major或独立显式协议。

可靠消息也不由board补全：D10 teamMessageDurable=false，可靠的协调输入应由同journal+outbox+目标消费ack产生；未实现/未核验时unknown。H05替代可能增加存储I/O、延迟及消息去重成本，批准本身不会证明实现。

## 6. 验收与未证实范围

| 执行阶段 | 必须交付的证明 | 当前事实 |
|---|---|---|
| 本节点L1 | 七份合同自洽、字段两侧映射有来源、错误码闭合、导入规则/authority判据可机检 | 文档检查；不会调用产品测试/模型 |
| L2 core/storage | I01–I08/A01–A15、11图校验、A/B判定、预算/幂等/原子outbox故障用例 | 未实现/未运行 |
| L3 两host | 同suite运行并保留manifest差异、实际activation/parent-child覆盖和版本pin | 仅原生probe指定范围，非新版adapter资格 |
| l1_replan真人门 | H01–H13精确内容/身份/授权签署；ADR另走图流程 | 全pending，approvalRef=null |

可选CLI/Git/SQLite/SP必须可以全部不装而导入core、执行memory纯协议smoke。持久恢复与OSsandbox是独立requirement；内存smoke通过不能满足它们。本文不把proposed ADR定案，不代签human approval，不修改graph状态。

