lane: l3-pi-b
cp1: passed — src/hosts/pi/evidence/0992-live-trace.json 与 .kernel.json；真实 Pi 0.99.2 已有 disk session 内加载 extension，真实内核 step 应用一个回执、停在 verifying；两条 DeepSeek high 请求，共 21920 tokens（cacheRead 10752，output 163，reasoning 为 output 子集 111）。
cp2: passed — provider-live 的 additive context、controlled AGENTS/skill/read、原生 tool_result 和 raw/SDK usage 对齐；native-fixture 的 denied tool、boundary continuation、重入拒绝，另有 contract fixtures。
cp3: passed — 0.99.2 native disk reopen 的同 ID/custom entry/同 receiptId、idempotent readback；native unload 后普通 host prompt、SDK abort/native-ack/HTTP 断连，缺 meter 保留 unknown。
版本重验: P1 provider-live；P2 provider-live controlled resources；P3 native-fixture，provider-live 拒绝路径 unknown；P4 provider-live；P9 native-disk；P17 provider-live end/settled 顺序 + native-fixture boundary/async settled/reentry/abort。当前用户 TUI/全部第三方共存、provider retry/compaction 未证。
门禁: build/typecheck/src:policy/dep:check exit=0；聚焦测试两次均 37 tests、37 pass、0 fail（32 个行为测试 +5 个辅助文件加载子测试）；static-audit exit=0、0 violations；git diff --check=0。详细命令/stdout/source hashes 见 0992-gates.json。
真实请求与成本: 2 条 deepseek/deepseek-flash high；provider-1 prompt=10841/cache=0/output=59/reasoning=12，参考 USD=0.003323100；provider-2 prompt=10916/cache=10752/output=104/reasoning=99，参考 USD=0.000238512；合计 0.003561612（官方/catalog 峰时参考价，不是 invoice）。历史 MiMo 0.50 USD 累计预算未改。
未证明项: bootstrap 是 native-fixture，kernel 两条请求才是 provider-live；policy/clock/seed 与内核 stores 是显式测试端口、内核执行及宿主为真实代码，fake host execution=0；未执行 evaluator。Native reopen 非断电恢复；provider abort 计费、server-tier high、delegation、activation、OS sandbox、外部 effect exactly-once 和收益仍未知。
阻塞: 无。

DoD① 一条、DoD② 三条真实 native-fixture 进程负对照：源码变异→build→指定断言 exit 1→原字节恢复→build→exit 0。负对照及最终两次测试零付费请求；详细变异点、断言、独立 red/green 轨迹及 SHA256 见 0992-negative-controls.json。DoD① 删除持久 session gate；DoD② 包含 agent_end 提前写 completed receipt、settled 重入门禁删除、agent_end 清空 context packet。

FIX1 必修 major-1 已补齐并重跑四条控制：

- 重入：删除 execute 的 `if (!isIdle()) … EFK_HOST_REVISION_CONFLICT`；真实 native settled handler 中执行第二个 effect，`settledReentryRefused=false`，AssertionError 同名，red exit=1；逐字节恢复后该检查 true、green exit=0。0992-dod2-reentry-{red,green}.json 及各自 .kernel.json/.usage.json 为独立记录。变异的后续 context/continuation 也失败，不声称仅一项检查受影响。
- context 失效：`active.ended = true;` → `active.ended = true; packet = [];`；boundary 第三请求 nodeContextInjected=false，host context/skill 仍保留，`contextAndResources=false`，AssertionError 同名，red exit=1；逐字节恢复后 true、green exit=0。轨迹为 0992-dod2-context-{red,green}.json 及各自 .kernel.json/.usage.json。
- 两项原/恢复 SHA256 均为 401fb5ce46258074d25af30c313f5d95c91395e0c2be2c6031aa738201482672；变异哈希分别为 4d03406e52832489a65e9d6c57f996c24add6b6b05fda34fd7ff1ca1b5447ff6、3b1c3309860b2f01ac1ae739414f93df5c4fd808c2e256048854b285aa711226。本轮最终运行源码不变。

FIX1 minor/nit 收口：

- minor-1 模型切换：依据 docs/evofence-harness-kernel/execution/SESSION-006-HANDOFF.md §1.3 用户裁决，本轮使用 deepseek/deepseek-flash high。本机 Xiaomi/MiMo 与 DeepSeek 均可选，SDK 重定及模型选择分别说明；历史 MiMo $0.50 累计预算保留。受 FIX1 落点约束，pin 与 HOST-MAPPING.md 未再修改，说明补到 VERSION-DIFFERENCES.md/本报告。
- minor-2 历史 live 取证可复现性：保留未证明边界。旧 trace 记录迁移前 native-session.mjs:74b6780e… / native-support.mjs:316a7602…，无法由当前 test harness 逐字节复现；binding.ts 运行逻辑哈希相同、types.ts 为类型声明修正。原 live trace 不改写，本轮不为此重复付费，新增 paidRequests=0。
- nit-1：用当前实际 Pi --probe --memory-control 重跑 0992-memory-control.json，exit=0，nativeMemorySessionRefused/extensionErrorsEmpty 均 true，七个 sourceHashes 随本次实际执行记录，paidRequests=0。

版本适配：目标从 0.87.1 更新为 0.99.2，旧 pin 完整保留为 history[0].pin；非 0.99.2 仍在 SDK/hook 触碰前拒绝。Tool 类型补入 parentToolCallId、structuredContent。0.87.1 tag 已有 agent_before_settle，本轮是该行为的版本重验，非其首次引入。Local session capability view 将未重验 child/server reasoning 留为 unknown；core 原矩阵未修改。

HOST-MAPPING.md 独立 diff：只改 PV 的 Pi 版本行，明确旧 P1–P17 为历史、按 0.99.2 重验/补差。L1 HOST-MANIFEST/live/offline/README、integrations/pi 与 core 原样保留。

复现：
npm run build
node test/l3-pi-native-session.test.js --probe --output=src/hosts/pi/evidence/0992-native-trace.json
node test/l3-pi-negative-controls.test.js --mutate
node test/l3-pi-gates.test.js --gates

native-session 的 --probe --live 入口会消费额外请求，不要为了重复已有证据自动执行。LIVE 取证后仅有类型声明补齐及探针断言/布局修正，运行逻辑 hashes 仍相同，未重复付费。既有会话 JSONL/controlled resources 保存在 trace 中标注的独立 TEMP 路径；产物都留 lane。未 commit/install/操作 .graph/发布；无后台进程遗留。

FIX1 最终复验：四项门禁 exit=0；node --test test/l3-pi-*.test.js 两次均 37/37（32 行为测试 +5 辅助文件子测试），static-audit 0 violations；git diff --check exit=0。门禁逐条 argv/stdout/stderr 与当前源码哈希见 0992-gates.json。本次追加付费请求为零；独立复核的最终 verdict 由复核方决定。

FIX1 改动文件清单（相对本次开始时的字节快照，27 个；包含重新生成的既有负控证据）：

- src/hosts/pi/VERSION-DIFFERENCES.md
- src/hosts/pi/evidence/0992-SUMMARY.json
- src/hosts/pi/evidence/0992-dod1-green.json
- src/hosts/pi/evidence/0992-dod1-red.json
- src/hosts/pi/evidence/0992-dod2-context-green.json
- src/hosts/pi/evidence/0992-dod2-context-green.json.kernel.json
- src/hosts/pi/evidence/0992-dod2-context-green.json.usage.json
- src/hosts/pi/evidence/0992-dod2-context-red.json
- src/hosts/pi/evidence/0992-dod2-context-red.json.kernel.json
- src/hosts/pi/evidence/0992-dod2-context-red.json.usage.json
- src/hosts/pi/evidence/0992-dod2-green.json
- src/hosts/pi/evidence/0992-dod2-green.json.kernel.json
- src/hosts/pi/evidence/0992-dod2-green.json.usage.json
- src/hosts/pi/evidence/0992-dod2-red.json
- src/hosts/pi/evidence/0992-dod2-red.json.usage.json
- src/hosts/pi/evidence/0992-dod2-reentry-green.json
- src/hosts/pi/evidence/0992-dod2-reentry-green.json.kernel.json
- src/hosts/pi/evidence/0992-dod2-reentry-green.json.usage.json
- src/hosts/pi/evidence/0992-dod2-reentry-red.json
- src/hosts/pi/evidence/0992-dod2-reentry-red.json.kernel.json
- src/hosts/pi/evidence/0992-dod2-reentry-red.json.usage.json
- src/hosts/pi/evidence/0992-gates.json
- src/hosts/pi/evidence/0992-memory-control.json
- src/hosts/pi/evidence/0992-negative-controls.json
- src/hosts/pi/evidence/LANE-REPORT.md
- test/l3-pi-gates.test.js
- test/l3-pi-negative-controls.test.js

静态审计重跑结果与既有 0992-static-audit.json 逐字节相同，因此该文件不计入变更清单。binding.ts 原字节恢复；VERSION-PIN.json、HOST-MAPPING.md 与三份 provider-live 产物均与 FIX1 开始时相同。
