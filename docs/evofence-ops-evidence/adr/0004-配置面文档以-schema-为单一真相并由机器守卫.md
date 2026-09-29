# 0004 — 配置面文档以 schema 为单一真相并由机器守卫

docs/config.md 声明的配置面（required 路径全集、两个代码默认值、四类文档失败码）由脚本从 src/lib/config/schema.ts 求解后逐项比对，出现漂移即 CI 失败；文档保留规则解释与边界叙述，不由 schema 整体生成。

**Status：** accepted

**Context：** CLI 命令面有 catalog manifest 加冒烟守卫，src 策略与依赖分别有 check-src-policy.mjs 与 check-deps.mjs，但 docs/config.md 自称 required 路径完整却没有任何机器守卫。0.4.0 刚经历过 run 与 status 对同一文件判断不一致这类第二真相问题。

**Considered Options：** A 保持人工维护文档，落选：契约文件与文档会静默漂移；B 由 schema 整体生成 docs/config.md，落选：文档含规则解释与边界叙述，纯生成会丢内容；C 从 schema 求解后比对并报告可定位差异，选中。

**Why：** 与仓库既有的守卫传统一致：同一契约只允许一个真相，差异必须可定位；实现零依赖且不改运行时行为。

**Consequences：** 文档中该段落的措辞与 schema 求解口径绑定，修改叙述时需保持两者一致；脚本成为配置面契约的回归防线，schema 变更若忘记同步文档会在 CI 被拦下。

> 本文由 `graph export` 从图顶点 adr_0004 生成；改图不改文，重新导出即覆盖。
