# 网关日志页：统计上移折叠 + 筛选下拉拉数据 + 列重构

## Goal

继双表日志 + UI 打磨之后，进一步提升网关日志页（admin/panel 的 usage 页）可用性：统计区上移并可折叠、筛选项从手填升级为下拉拉取、列表列合并紧凑化并支持行内明细。

## Background

当前日志页（gateway-log-ui-polish 已交付）仍存在：

- 统计仪表盘嵌在「用量明细」tab 内部，「错误请求」tab 无总览；统计区不可收起，列表空间被挤压。
- 筛选栏 model/provider/route 全是纯文本手填 + 精确匹配，没有「用户」筛选，没有独立时间范围筛选；用户得记住准确的模型/服务商名才能筛。
- admin 用量表 10 列平铺，无用户列、无独立服务商列；同维度信息分散（路由、token、耗时各自占列），扫视效率低。

参考 sub2api 日志页（`docs/cankao/sub2api/frontend/src/views/admin/UsageView.vue`）：统计区跨 tab 共享置于上方；筛选用下拉且候选项从后端拉取；表格对 token 等成对字段做单元格内堆叠 + hover 明细。

## Requirements

### R1. 统计区上移 + 可折叠

- UsageDashboard 从「用量明细」tab 内部移到 UsageTabs 上方（admin + panel 两个 page）。
- 统计内容保持现状（成功计费那套总量卡 + 趋势/模型/来源图），切 tab 不变；「错误请求」tab 上方也看同一套用量统计。
- 加折叠按钮：收起/展开统计区，状态持久化（localStorage），收起后只留一条触发条。

### R2. 筛选下拉拉数据

- 用量明细 + 错误请求筛选栏：模型 / 服务商 / 路由 由「文本手填」改为「下拉选择」，候选项从数据库 distinct 拉取（SSR 注入），不再手填。
- 新增「用户」筛选（仅 admin）：下拉选有日志记录的用户，候选项 = distinct userId JOIN user 取 name + email。
- panel 不加用户筛选（数据已按当前用户隔离）。
- 候选项随 userId 隔离（panel 只看到自己的模型/服务商/路由）。

### R3. 预设时间范围筛选

- 筛选栏新增「时间范围」下拉：近 24h / 7d / 30d / 全部。复用现有 range → startAt 逻辑。
- 把时间范围独立进筛选栏，与列表 + 统计共用同一 range；移除 dashboard 内部重复的 range 选择器。

### R4. 列重构 + 行内明细

- admin 用量表列合并紧凑化（从 10 列 → 约 7 列）：
  - 时间
  - 用户（新增，admin only；name 主 + email 副）
  - 来源
  - 路由合并列：服务商 · 路由名 · 请求模型(↳上游模型) 上下排列
  - Key（保留：apiKeyName + 脱敏上游 key）
  - Token 合并列：输入↓ 输出↑ ／ 缓存读取（上下两行），旁加 info 图标 hover 看明细
  - 耗时合并列：总耗时 ／ TTFT 上下排列
- panel 用量表同步合并列（无用户列；Key 仅 apiKeyName 自己的）。
- 错误请求表：服务商/路由/模型 同样合并为一列；保持现有 ErrorDetailDrawer（点行触发）。

## Constraints

- 不破坏双表分流 / 数据层脱敏（panel 错误视图敏感字段仍不下发）。
- panel 用户隔离不变（无用户筛选；列重构共用组件，panel 不展示用户列）。
- 双 dialect 对齐（distinct 查询 pg/sqlite 兼容）。
- 时间显示保持固定东八区（formatDateTimeLocal 现状，避免 hydration 回归）。
- DESIGN.md 合规（莫兰迪 / 零影子 / 无彩色粗条 / 无 eyebrow）。
- 候选项拉取走 SSR 注入（page 是 server component），不开 typeahead 搜索接口、不新建 DateRangePicker 组件。

## Out of Scope

- typeahead 搜索接口 / 自定义起止日期选择器（仅预设区间）。
- 用量表重型行详情 Modal（沿用 token hover tooltip + 错误表 drawer）。
- 用量统计图内容扩展（错误专属统计图，后续）。
- panel 页独立用户筛选（隔离语义不需要）。

## Acceptance Criteria

- [ ] 统计区位于 tab 上方，切 tab 不变；折叠按钮可收起/展开，状态 localStorage 持久
- [ ] 模型/服务商/路由筛选项为下拉，候选项从库 distinct 拉取（非手填）
- [ ] admin 有「用户」筛选下拉（name+email），panel 无
- [ ] 时间范围下拉（24h/7d/30d/全部）同时作用于列表 + 统计
- [ ] admin 用量表合并列：路由(服务商·路由·模型↳上游)、token(输入/输出/缓存+hover明细)、耗时(总/TTFT)；含用户列
- [ ] panel 用量表同步合并列（无用户列）
- [ ] 错误表服务商/路由/模型合并为一列
- [ ] panel 错误视图仍脱敏；时间显示东八区无 hydration 报错
- [ ] `pnpm check` + `pnpm test` 通过
