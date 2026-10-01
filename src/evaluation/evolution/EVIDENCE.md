# l4-evo-eval 交付证据

lane: l4-evo-eval；branch: refactor/hk-l4-evo-eval；baseline: d2e311d。

cp1: passed — `cp1: preregistration binds candidate/base/hosts/model/protocol/splits and cannot be rewritten after results`；
host manifest 字节与版本/model/payload 核对、repo/family/instance 隔离、实际 diff/attempt 绑定、
权威证明、过期资格拒绝。入口 `index.ts`，使用与信任合同见 `README.md`。

cp2: passed — `cp2 same seeds replay identically; different seeds/trials are retained and never chosen by their best result`；
配对分层 repo bootstrap 10,000 draws、BCa/McNemar/score-null 敏感性；固定序列、futility、
discordance floor、ci-spans-mve 与质量/成本/墙钟/稳定性指标。成本/墙钟/截断护栏失败时
保留统计 positive，但禁止收益资格；缺预算/样本/不确定测量直接阻止声明。

cp3: passed — `evidence/mutations.json` 及各 `.green/.red/.restored.txt`：budget-bypass、
sample-bypass、selection-bias、leakage-bypass、usage-as-zero、forged-authority、task-as-evolution
共 7 项真实生产模块变异，每项 exit 0 → 1（断言变红）→ 0，磁盘模块字节保持不变。
缺 usage 不补零、保留预留；隐式请求、reasoning/total 矛盾、重复请求拒绝。
可信 journal 的 evidenceKind 禁止 fixture/offline 升为 unseen。

DoD② 消费证据：`DoD2 production consumer uses the real receipt: registry validates then separately promotes; failed eval cannot transition`
把本服务的 receipt/decision 传给既有 `recordDecision`；staged → validated → 独立 promotion
decision → promoted 确实执行。无预算评价不能进入 validated。独立服务的
`evaluationForPromotion` 同时拒绝 task verdict、伪 issuer/签名、替换 receipt、失效证据。

门禁数字（完整机器结果 `evidence/results.json`）：

| 门禁 | 结果 |
|---|---|
| npm run build | exit 0 |
| npm run typecheck | exit 0 |
| npm run src:policy | exit 0；239 TS，0 JS；全仓最大 350 行 |
| npm run dep:check | exit 0；239 modules，934 edges，0 cycles |
| node --test test/l4-evo-eval-*.test.js | 两次 exit 0；38 tests / 38 pass / 0 fail；用例名称一致 |
| node verification/kernel/static-audit.mjs | exit 0；0 violations；88 modules / 358 edges |

Node 的 38 项计数包括 mutation 子用例、父测试与 fixture 模块装载项；不是 38 次真实未见试验。
新增 TypeScript 文件最多 159 行，测试最多 184 行。既有 tracked 文件 diff 为空；未 commit、
未 install、未操作 `.graph`，未改 core/冻结协议/资产注册器。

真实离线证据：`evidence/offline.json` 保存 base digest、由真实 `git diff --no-index` 生成并
去标识的 diff、12 个独立 Node subprocess 的 stdout/stderr、产物/私有检查摘要及分析。
六个手工 dev 实例使用相同任务形态：数字字符串求和；对照 0/6，修复 6/6，付费请求 0。
判决 inconclusive，benefitClaimAllowed=false；不得据此声明能力收益。临时目录只含本次
创建的源码快照，完成后核对绝对路径归属并清理。

未证明项：真实未见收益归 l4_capability_trial；真实 T0/试验预算仍未发生；测试中的
confirmatory/provider/T0/journal 是模拟 fixture。生产 signer/root/journal、真实 host/provider
结算与 l4_promotion 应用接线待对应 lane 集成。SHA-256 不等于签名；same-user 不等于
OS sandbox；static-audit 的 I04/I05 best-effort 局限沿用既有报告，未升级为形式证明。

阻塞：无。未发现必须改变冻结契约的 drift。
