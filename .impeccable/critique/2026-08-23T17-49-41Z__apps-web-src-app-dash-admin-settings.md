---
target: apps/web/src/app/(dash)/admin/settings
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-08-23T17-49-41Z
slug: apps-web-src-app-dash-admin-settings
---
Method: dual-agent (A: settings_critique_a · B: settings_critique_b)

# 系统设置页设计评审

## Design Health Score

| # | 启发式原则 | 分数 | 核心问题 |
|---|---|---:|---|
| 1 | 系统状态可见性 | 3/4 | 草稿、revision、发布状态完整，但发布影响仍不够直观 |
| 2 | 系统与现实世界匹配 | 3/4 | 事务语义真实，resource key 对非研发管理员仍偏技术化 |
| 3 | 用户控制与自由 | 3/4 | 支持放弃草稿、历史和反向撤销，但缺少清晰的发布前影响确认 |
| 4 | 一致性与标准 | 3/4 | 大体遵循项目设计系统，仍存在无效字号 token 和直写状态色 |
| 5 | 错误预防 | 3/4 | revision 与原子变更降低误操作，复杂治理阈值缺少建议值和风险提示 |
| 6 | 识别而非回忆 | 3/4 | 搜索、Tab、单位和范围标签清楚，输出设置的内部分类仍需用户记忆 |
| 7 | 灵活性与效率 | 3/4 | URL Tab、搜索和移动端 select 有效，搜索交互尚不具备完整键盘模式 |
| 8 | 美观与极简设计 | 2/4 | 冷白、细边框克制，但仍是常见 SaaS 设置页语法，层级压缩过度 |
| 9 | 错误识别与恢复 | 3/4 | 错误、冲突和撤销路径存在，历史记录缺少更易读的 before → after |
| 10 | 帮助与文档 | 2/4 | 字段 hint 基本齐全，缺少阈值建议、影响范围说明和复杂配置指导 |
| **总分** |  | **28/40** | **Good：基础扎实，但未达到顶级（36–40）** |

## Anti-Patterns Verdict

**LLM assessment**：不像低质量 AI 模板。冷白、莫兰迪中性、细边框、静止无投影与 Nekusora 的「星枢天流」方向一致。但“搜索 + 胶囊式 Tab + 多组白色描边面板 + 底部吸附发布条”仍是常见 SaaS 后台构图，尚未形成 Linear、Stripe、Figma 那种鲜明的信息分层与发布确定感。

**Deterministic scan**：扫描 `apps/web/src/app/(dash)/admin/settings`，命中 0 条规则，无文件位置；这说明没有明显的机械式 AI 反模式，不代表真实可用性已经通过。

**Visual overlays**：未能注入。独立浏览器访问 `http://127.0.0.1:3100/admin/settings` 返回 `net::ERR_CONNECTION_REFUSED`，因此没有可靠的用户可见 overlay。视觉结论以源码、设计规范和双上下文评审为后备信号。

## Overall Impression

这是一个工程语义比视觉语义更成熟的专业后台：真实草稿、revision、整批原子发布和反向撤销已经远超普通设置页；最大的机会是把这些服务端优势直接变成“发布前一眼确定影响、发布后一键追溯”的界面优势，而不是继续沿用普通表单页外壳。

## What's Working

1. **真实变更控制已经进入 UI**：草稿、revision、放弃、发布历史和反向撤销不是假按钮，用户控制感和系统可信度基础很好（`SettingsChangeControl.tsx:60-140`）。
2. **可发现性基础完整**：设置搜索、URL 驱动 Tab、移动端原生 select 和锚点跳转让大设置面不至于失控（`SettingsTabs.tsx:45-103`）。
3. **治理表单的业务语义清楚**：Key/User 两种 Scope、单位、上下界、保存状态和历史采集形成了完整的数据闭环（`GovernanceSettingsForm.tsx:120-220`）。

## Priority Issues

### [P1] 顶部与底部两套 sticky 控制区争夺视口

**Why it matters**：顶部搜索/Tab 与底部变更控制同时固定，在笔记本和移动端会显著压缩配置画布；复杂表单越长，用户越容易产生被工具栏夹住的感觉。

**Fix**：形成单一“设置工作台框架”：桌面端把变更集收进右侧固定活动栏，内容区只保留顶部分类；窄屏将活动栏折叠为单个底部入口，并为展开态预留安全区。不要让两个完整工具条同时吸附。

**Suggested command**：`$impeccable adapt`，随后 `$impeccable layout`。

### [P1] 信息架构压缩过度，输出体验混合两个心智模型

**Why it matters**：顶层只有 4 类，但“输出体验”同时包含行为/提示词性质的输出模式，以及 CSS/渲染性质的输出样式。用户必须进入后再重新理解，分类表面更少，认知成本反而更高。

**Fix**：保留顶层四大域，但为每个域提供常驻二级目录和域摘要；“输出体验”内部明确拆成“行为模式”和“视觉渲染”，搜索结果同时显示所属路径。桌面端用左侧窄目录，移动端用分组下拉，不增加新的全局 Tab。

**Suggested command**：`$impeccable shape`，随后 `$impeccable clarify`。

### [P1] 发布前缺少真正的影响摘要

**Why it matters**：当前只显示变更数量和 resource key，无法让管理员在一次发布前快速回答“改了什么、影响谁、风险多大、能否安全撤销”。这削弱了整批原子发布这一核心能力的产品价值。

**Fix**：发布前展示按领域归组的 before → after、影响范围、风险等级、关联资源和回滚目标；默认只显示摘要，按需展开原始 key。发布按钮应进入明确的 review step，而不是直接依赖资源键列表。

**Suggested command**：`$impeccable clarify`，随后 `$impeccable polish`。

### [P2] 治理矩阵一次暴露过多数字

**Why it matters**：2 个 Scope × 7 个指标要求管理员同时做 14 个数值决策；虽然排版整齐，但缺少当前峰值、推荐阈值和风险区间，容易形成“能填但不敢改”。

**Fix**：按吞吐与月额度渐进展开；每项显示当前使用峰值、建议范围和变更后预估，保留高级用户直接编辑矩阵的入口。

**Suggested command**：`$impeccable distill`。

### [P2] 设计 token 与本地化存在可验证的规范漂移

**Why it matters**：辅助信息使用 `text-neutral-400` 违反 `DESIGN.md` 对信息性文字最低对比度的约束；直写红色绕过状态 token；历史时间没有显式使用应用 locale；`text-ui-subtitle` 未在项目字号 token 中定义。

**Fix**：信息文本改用 `text-ink-tertiary` 或合适的中性色，错误态统一 semantic danger token，时间统一 `Intl.DateTimeFormat(locale)`，标题改用 `text-ui-subheading`/`text-ui-title`。

**Suggested command**：`$impeccable audit`。

## Persona Red Flags

**Alex（高频管理员）**：搜索可以定位设置，但没有完整的方向键/Escape 搜索交互；发布审核仍以 resource key 为主；同时 sticky 会减少批量配置时的有效视野。高频操作可完成，但速度和确定感尚未达到专家工具水平。

**Sam（键盘与辅助技术用户）**：主要表单标签、focus ring 和状态直播基本存在；搜索弹层缺少 `aria-expanded`、`aria-controls` 与组合框键盘模式，复杂治理矩阵也缺少更强的分组导航。

**Gateway Maintainer（项目特定网关维护者）**：最关心发布影响、流量风险和快速回滚。当前 revision 与撤销能力可信，但发布前无法按领域和影响对象快速审计，阈值也缺少当前峰值对照。

## Minor Observations

- `SettingsChangeControl.tsx:91` 使用无显式 locale 的 `toLocaleString()`。
- `SettingsChangeControl.tsx:135` 与 `GovernanceSettingsSection.tsx:54` 直写 red 色阶，绕过语义状态 token。
- `BasicSettingsForm.tsx:81`、`EmbeddingConfigForm.tsx:96`、`BackgroundModelConfigForm.tsx:53` 的信息性 hint 使用 `text-neutral-400`，低于项目规范。
- `GovernanceHistoryPanel.tsx:38` 使用项目未定义的 `text-ui-subtitle`。
- 多个设置输入没有声明 `autocomplete` 策略；真实浏览器未启动，尚不能确认浏览器自动填充是否会干扰管理配置。

## Questions to Consider

- 如果“整批原子发布”是设置页的核心差异化，是否应该让变更集成为页面主框架，而不是底部附加条？
- 管理员在点击发布前，最需要先看到的是影响对象、风险等级，还是 before → after？顶级方案应能在同一摘要中回答三者。
- “输出体验”是否应保持一个全局域，但在域内明确分成行为与视觉两个二级工作区？
