lane: l3-pi-b
cp1: passed — src/hosts/pi/evidence/0992-live-trace.json 与 .kernel.json；真实 Pi 0.99.2 已有 disk session 内加载 extension，真实内核 step 应用一个回执、停在 verifying；两条 DeepSeek high 请求，共 21920 tokens（cacheRead 10752，output 163，reasoning 为 output 子集 111）。
cp2: passed — provider-live 的 additive context、controlled AGENTS/skill/read、原生 tool_result 和 raw/SDK usage 对齐；native-fixture 的 denied tool、boundary continuation、重入拒绝，另有 contract fixtures。
cp3: passed — 0.99.2 native disk reopen 的同 ID/custom entry/同 receiptId、idempotent readback；native unload 后普通 host prompt、SDK abort/native-ack/HTTP 断连，缺 meter 保留 unknown。
版本重验: P1 provider-live；P2 provider-live controlled resources；P3 native-fixture，provider-live 拒绝路径 unknown；P4 provider-live；P9 native-disk；P17 provider-live end/settled 顺序 + native-fixture boundary/async settled/reentry/abort。当前用户 TUI/全部第三方共存、provider retry/compaction 未证。
门禁: build/typecheck/src:policy/dep:check exit=0；聚焦测试两次均 37 tests、37 pass、0 fail（32 个行为测试 +5 个辅助文件加载子测试）；static-audit exit=0、0 violations；git diff --check=0。详细命令/stdout/source hashes 见 0992-gates.json。
真实请求与成本: 2 条 deepseek/deepseek-flash high；provider-1 prompt=10841/cache=0/output=59/reasoning=12，参考 USD=0.003323100；provider-2 prompt=10916/cache=10752/output=104/reasoning=99，参考 USD=0.000238512；合计 0.003561612（官方/catalog 峰时参考价，不是 invoice）。历史 MiMo 0.50 USD 累计预算未改。
未证明项: bootstrap 是 native-fixture，kernel 两条请求才是 provider-live；policy/clock/seed 与内核 stores 是显式测试端口、内核执行及宿主为真实代码，fake host execution=0；未执行 evaluator。Native reopen 非断电恢复；provider abort 计费、server-tier high、delegation、activation、OS sandbox、外部 effect exactly-once 和收益仍未知。
阻塞: 无。

DoD①/② 各一个真实 native-fixture 进程负对照：源码变异→build→exit 1→原字节恢复→build→exit 0。负对照及最终两次测试零付费请求；详细原因/轨迹/SHA256 见 0992-negative-controls.json。DoD① 删除持久 session gate；DoD② 在 agent_end 提前写 completed receipt。

版本适配：目标从 0.87.1 更新为 0.99.2，旧 pin 完整保留为 history[0].pin；非 0.99.2 仍在 SDK/hook 触碰前拒绝。Tool 类型补入 parentToolCallId、structuredContent。0.87.1 tag 已有 agent_before_settle，本轮是该行为的版本重验，非其首次引入。Local session capability view 将未重验 child/server reasoning 留为 unknown；core 原矩阵未修改。

HOST-MAPPING.md 独立 diff：只改 PV 的 Pi 版本行，明确旧 P1–P17 为历史、按 0.99.2 重验/补差。L1 HOST-MANIFEST/live/offline/README、integrations/pi 与 core 原样保留。

复现：
npm run build
node test/l3-pi-native-session.test.js --probe --output=src/hosts/pi/evidence/0992-native-trace.json
node test/l3-pi-negative-controls.test.js --mutate
node test/l3-pi-gates.test.js --gates

native-session 的 --probe --live 入口会消费额外请求，不要为了重复已有证据自动执行。LIVE 取证后仅有类型声明补齐及探针断言/布局修正，运行逻辑 hashes 仍相同，未重复付费。既有会话 JSONL/controlled resources 保存在 trace 中标注的独立 TEMP 路径；产物都留 lane。未 commit/install/操作 .graph/发布；无后台进程遗留。
