# 技术设计 — 网关日志页：统计上移折叠 + 筛选下拉 + 列重构

> 配套 prd.md。讲：统计折叠结构、筛选下拉数据流、distinct 查询、列合并布局、token tooltip。

## 1. 统计区上移 + 折叠（R1）

### 结构调整

admin/panel 两个 page.tsx 当前：
```
<h1>
<UsageTabs>
{tab===usage ? <><UsageDashboard/><UsageLogsTable/></> : <ErrorLogsTable/>}
```
改为：
```
<h1>
<CollapsibleStats>          ← 新增 wrapper（client，折叠 + localStorage）
  <UsageDashboard range={range} totals series byModel bySource />
</CollapsibleStats>
<UsageTabs>
{tab===usage ? <UsageLogsTable/> : <ErrorLogsTable/>}
```
- UsageDashboard 从 renderUsageTab 内部移出到顶层，两个 tab 共享；errors tab 上方也看同一套用量统计。
- 折叠状态 key：`usage-stats-collapsed`（boolean），localStorage 持久；收起时仅留 header 触发条。

### CollapsibleStats 组件

- 新建 `src/app/(dash)/admin/usage/CollapsibleStats.tsx`（"use client"）：header（标题 + 收起/展开按钮 chevron）+ 内容区（按 collapsed 显隐，条件渲染最简）。
- 默认展开；收起态读 localStorage 初始化（注意 SSR：首屏按 localStorage 不存在 → 默认展开，client mount 后校正，避免 hydration mismatch）。

### Dashboard range 统一

- 移除 UsageDashboard 内部 RANGES 选择器（R3 把 range 独立进筛选栏后重复）。
- range 改由 props 传入（筛选栏的 range query 驱动），dashboard 不再自持 setRange。
- range 同时驱动：dashboard 图表（getTimeSeries/getModelBreakdown/getSourceBreakdown 用 range 选 bucket 粒度）+ 列表（rangeToStart → startAt）。

## 2. 筛选下拉拉数据（R2 + R3）

### FilterField 扩展

UsageFilters 的 FilterField 已支持 type: text/select/checkbox。model/provider/route/user/range 改 type:"select" + options（SSR 注入候选）。无需新控件类型——native select 即可（候选项量小，不做搜索框）。

### distinct 候选查询（usage-aggregate.ts 新增）

```ts
export interface UsageFilterOptions {
  models: string[];
  providers: string[];                 // providerName distinct
  routes: string[];                    // routeName distinct
  users: { id: string; name: string; email: string }[]; // admin only
}
export async function listUsageFilterOptions(userId?: string): Promise<UsageFilterOptions>
```
- models/providers/routes：`SELECT DISTINCT col FROM usage_logs [WHERE userId] WHERE col IS NOT NULL ORDER BY col LIMIT 100`。
- users（仅 admin，userId 不传时）：`SELECT DISTINCT userId, user.name, user.email FROM usage_logs LEFT JOIN user WHERE userId IS NOT NULL`。
- panel 传 userId 隔离 → users 返回空数组（panel 不需要用户筛选）。
- 双 dialect：drizzle `selectDistinct` / `sql` distinct 表达式，pg/sqlite 均支持 `DISTINCT`。

错误表同理新增 `listErrorFilterOptions(userId?)`（ops_error_logs）。

### userId 筛选（admin）

- UsageLogFilters / ErrorLogFilters 加 `userId?: string`（admin 筛选用，区别于 opts.userId 隔离）。
- buildUsageWhere / buildWhere 加 `if (f.userId) conds.push(eq(t.userId, f.userId))`。
- 语义区分：`opts.userId`（panel 强制隔离，必传）vs `filters.userId`（admin 可选筛选）。admin 不传 opts.userId，仅可能传 filters.userId。

### page 注入

- admin/panel page.tsx：调 listUsageFilterOptions/listErrorFilterOptions → 注入 UsageFilters 的 fields options。
- filterValues 加 userId / range。
- range 复用现有 rangeToStart（"" → undefined 不限时间）。

### 用户列展示数据

- listUsageLogs 已 LEFT JOIN apiKeys；再加 LEFT JOIN user 取 name/email。UsageLogRow + UsageLogClientRow 加 userName/userEmail。
- 错误表 listErrorLogs 同理（admin 用户列）。

## 3. 列重构 + token tooltip（R4）

### admin 用量表新列布局

```
时间 | 用户 | 来源 | 路由(服务商·路由·模型↳上游) | Key | Token(↓↑/缓存 +info) | 耗时(总/TTFT)
```
- 路由列：上行 providerName；中行 routeName；下行 model（主）+ ↳upstreamModel（副灰）。
- Token 列：上行 input↓(neutral) output↑(neutral)；下行 cacheRead（>0 才显示）；右侧 info 图标 → Popover(openOnHover) 四行明细（输入/输出/缓存读取/总计）。
- 耗时列：上行 latency；下行 ttft（灰）。
- 用户列：name（主）+ email（mono 灰副）。
- DESIGN 约束：箭头/颜色低饱和（不引入彩色粗条）；用 neutral/sora-blue 系。

### token tooltip

- 复用 Popover（openOnHover=true）。trigger = info 图标 button；panel = 四行 token 明细。
- UsageLogClientRow 已有 promptTokens/completionTokens/cacheReadTokens，无需新字段。

### panel variant

- UsageLogsTable 加 `variant?: "admin" | "panel"`（同 ErrorLogsTable 模式，默认 admin）。
- panel：无用户列；Key 仅 apiKeyName（upstreamKeyMasked 已 null）；其余合并列同。

### 错误表

- 服务商/路由/模型三列合并为一列（providerName · routeName · model↳upstreamModel）。
- admin 加用户列；保持现有 phase/category/httpStatus/latency 列 + ErrorDetailDrawer（点行触发，不变）。

## 4. i18n

新 key（zh-CN + en）：
- 折叠按钮：收起 / 展开（statsCollapse / statsExpand）。
- 用户列头 thUser；token tooltip 行标签：输入/输出/缓存读取/总计。
- 时间范围筛选 label filters.range（errors 已有，usage 补）。

## 5. 风险

- distinct 性能：usage_logs 量大时 distinct 慢。限 100 + 可选 createdAt 近 30d 范围缓解；必要时加索引（createdAt 已有）。
- 列合并后信息密度高，注意 truncate + max-w 防溢出。
- panel 共用 UsageLogsTable 加 variant，确保不泄露 admin 专属字段（用户列、upstreamKeyMasked）。
- dashboard range 移除后，确保筛选栏 range 能驱动图表（range props 贯通 page → dashboard + aggregate）。
- range=全部时图表 bucket 粒度：列表 startAt=undefined 不限；图表 range 降级用 30d 粒度（或单独处理），实现时定。

## 6. 不在本设计内

typeahead 接口、自定义日期选择器、错误专属统计图、panel 用户筛选、用量表重型行详情 Modal。

---

## 9. 迭代:级联 typeahead 筛选(用户反馈 v2,覆盖 §2)

> 用户选定后端 typeahead(sub2api 同款)。筛选系统从「SSR 候选 + apply」重构为「typeahead + 级联即时」。
> §2 的 SSR distinct 注入(listUsageFilterOptions)保留作首屏兜底,运行时筛选改 typeahead。

### 9.1 架构:Server Action typeahead
项目无 admin API route(admin 数据走 `actions.ts` server action + server component 直查)。
typeahead 沿用 server action(不引入新路由/鉴权模式):
- 新建 `searchUsageCandidates({type, q, userId, providerName})` action
- type: `users`(admin) / `keys` / `providers` / `models` / `upstreamKeys`
- 双 dialect distinct + 大小写不敏感 LIKE(q) + 级联 filter(userId / userId+providerName)
- 返回 `[{id, label, sub?}]`,限 30

### 9.2 Combobox 组件(`shared/ui/Combobox.tsx`)
- Popover + Input + 候选列表;debounce(250ms) 输入 → 调 `loadOptions(q)` → 显示候选
- 受控(value/onChange);支持依赖参数(级联:userId/providerName 变 → 重查)

### 9.3 级联联动 + 两排布局
- 第一排:时间区间 / 用户(admin 默认自己,可改;panel 固定自己) / 来源(枚举 chat/gateway) / 密钥
- 第二排:服务商 / 模型 / 上游key
- 用户 → 密钥/服务商候选按 userId 过滤;服务商 → 模型/上游key 按 userId+providerName 过滤
- **服务商未选 → 模型/上游key 禁用**;选用户/服务商变化 → 下级清空 + 即时刷新
- 去掉「路由」筛选;交互从「填完 apply」改为「选定即 router.push 刷新」

### 9.4 DateRangePicker(自定义时间)
时间选项:今天/昨天/24小时/7天/30天/自定义(两个 date input 起止)。默认**今天**。
range query 扩展:`today`/`yesterday`/`24h`/`7d`/`30d` + `start`/`end`(ISO)。

### 9.5 执行链路列(覆盖 §3 用量表列)
- 去掉 `routeName`(冗余组合名「服务商·上游模型」,与上下行重复)
- 列内容 = 服务商 + 请求模型(↳上游模型) + 脱敏上游key;列名「执行链路」
- 原 Key 列只剩对外密钥(apiKeyName);上游key 移到执行链路列

### 9.6 新筛选维度
`UsageLogFilters`/`ErrorLogFilters` 加 `apiKeyId?`(密钥) + `upstreamKeyMasked?`(上游key)。
panel 错误视图仍脱敏(不下发 upstreamKeyMasked 值,但可按其筛选)。

### 9.7 分阶段
- A 后端:筛选维度 + `searchUsageCandidates` action(usage + error)
- B 组件:Combobox + DateRangePicker
- C 前端:筛选两排 + 级联 + 即时刷新 + 执行链路列
- D 验证
