# 任务简报：l1_dsh_probe（DSH 原生会话与团队能力探针）

> 执行者：codex（pane wG:p3，cwd = 本 worktree）。图状态由 orchestrator S02 记录，你**不要**改 `.graph/`。

## 0. 工作区与基线

- cwd：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`
- git HEAD `d47f883`（detached），源码零改动；untracked：`docs/evofence-harness-kernel/`、`scripts/probes/`
- 图真相源：`.graph/evofence-harness-kernel/`（**只读**，禁止改动；状态流转只由 orchestrator 经 graph CLI 执行）
- 本节点上游 `l1_review` 已 passed；下游 `l1_api_freeze` 等你和另两个 L1 节点

## 1. 先读（按顺序，都是本 worktree 内文件）

1. `docs/evofence-harness-kernel/execution/SESSION-PROTOCOL.md` —— 执行协议与授权边界
2. `docs/evofence-harness-kernel/execution/SESSION-001-HANDOFF.md` —— 前序 Pi 探针的做法与结论（**你的 DSH 探针应与它同构**）
3. `docs/evofence-harness-kernel/ARCHITECTURE.md`、`CONTRACTS.md` —— HostManifest / HostPort 草案语境
4. `docs/evofence-harness-kernel/SOURCES.md` —— 已有 DSH 官方资料线索（含 Context7 引用）
5. `scripts/probes/pi-native-probe.mjs` + `scripts/probes/pi-probe-support.mjs` —— **探针脚本的既有范式，照此结构写 DSH 版**
6. `docs/evofence-harness-kernel/probes/pi/` —— 产物范式：`README.md`、`HOST-MANIFEST.json`、`VERSION-PIN.json`、`offline-trace.json`、`live-trace.json`
7. 节点合同：`node .graph/../` 不可读时用 CLI：`graph get-node -i l1_dsh_probe --graph evofence-harness-kernel`
8. 管辖 ADR：`adr_0001`（宿主内嵌内核与显式子图委托）、`adr_0006`（双宿主同等准入与显式差异）

## 2. 节点合同（必须逐条满足）

**Plan**：输入＝固定的 DSH 版本、官方 agent/team/tools/session-projection 文档与 HostManifest 草案。用最小无模型或显式预算原型验证 `agent/pre-step`、`tools/pre-execute`、`tools/result`、团队服务、usage、取消、恢复、投影顺序及 authority 身份。输出＝可复现能力矩阵和局限。**不得把 master 文档当本机 API 已成立。**

**DoD**
- 原生生命周期与团队委派有逐能力证据、版本与失败路径。
- 识别工具 hooks 与 OS 隔离差异；未知项不填 verified。

**Checkpoints（完成后逐项回报，我据此上报）**
- `cp1` 固定版本与钩子清单
- `cp2` 验证生命周期/取消/恢复
- `cp3` 记录用量与权限可观测性

## 3. 本机事实（已实测，不必重复验证）

- 全局安装：`@deepseek-ai/dsh@0.1.7-rc.1`，入口 `C:\Users\Calvin-Xia\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`，命令 `dsh`
- `dsh --version` → `0.1.7-rc.1`
- `dsh` 形态：`dsh [--profile] <name> [options] [app-args...]`，即"启动一个 profile = 有序 plugin-bundle patch 层栈"；`dsh web` 启 web profile；有 `--dump-config` / `--dump-config-schema` / `--dump-default-config` 三个 introspection 开关
- 本机另有 `@deepseek-ai/dsh-tools`（peer，见 `integrations/` 内 integration package）；`~/.codex` 与 Pi 的凭据**不得**打印、不得写进仓库/日志/产物
- DSH_HOME 疑似 `C:\Users\Calvin-Xia\.dsh` 或 `$DSH_HOME`——**自行核实真实值**再断言

## 4. 交付物（写入这些路径，都是全新、无冲突 lane）

```
docs/evofence-harness-kernel/probes/dsh/README.md          能力矩阵正文 + 局限 + 未验证项
docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json 与 Pi 版同构的宿主 manifes
docs/evofence-harness-kernel/probes/dsh/VERSION-PIN.json   固定版本 + 关键文件 SHA256
docs/evofence-harness-kernel/probes/dsh/offline-trace.json 无模型/离线路径的真实轨迹
docs/evofence-harness-kernel/probes/dsh/live-trace.json    如发付费请求才有；否则写 {"status":"not-run","reason":"..."}
scripts/probes/dsh-native-probe.mjs                        探针本体（可复现、可重跑）
scripts/probes/dsh-probe-support.mjs                       版本解析/隔离/预算辅助
```

## 5. 硬约束

1. **不打印、不写盘、不进命令行**任何 API key / token / auth.json 内容。需要认证时只从既有接口内存读取。
2. 不修改 `.graph/`、`package.json`、`src/`、`test/`、`test-e2e/`、`integrations/` —— 本节点只产出 `probes/dsh` lane。
3. 不执行 `git commit`、不 `git checkout`、不切分支、不改 `.git`。落盘只写上面 4 节列的文件。
4. 不跑 `npm publish` / 不打 tag / 不装全局包。
5. 无法验证的能力**必须**在能力矩阵里标 `unverified` 或 `unknown`，附失败路径；**绝不允许**把官方 master 文档的描述写成"本机已成立"。
6. 区分"离线/fixture 证据"与"真实付费实跑证据"两级，分别标注。**不要**为了凑证据擅自发大量付费请求；若确需实跑，先说明单次上界与总次数，最多 2 次最小请求。
7. 时间盒：本节点应在一轮内给出可复现结论；发现 API 与文档不符时，**如实记录差异**而不是绕开。

## 6. 完成时回报格式（回给我，简洁）

```
cp1: <passed|failed> — <一句话证据>
cp2: ...
cp3: ...
交付文件: <路径列表>
实测命令: <命令 + 退出码>
关键结论: <3-6 条，含未验证项>
阻塞: <无 / 具体描述>
```

写完后不要自己改图状态，我会做 verdict 与状态流转。
