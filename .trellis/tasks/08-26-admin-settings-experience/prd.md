# 完善管理与设置体验

## Goal

改善账号管理、运维监控与设置中心的可理解性、响应速度和交互反馈，同时保持现有权限、数据模型与路由边界不变。

## Confirmed Facts

- 账号管理由 `/admin` 布局和 `requireAdmin()` 双重限制，仅管理员可见；当前页面只有启停操作，没有删除入口（`apps/web/src/app/(dash)/admin/actions.ts:819`、`apps/web/src/app/(dash)/admin/users/page.tsx:9`）。
- Better Auth 1.6.23 的 admin 插件已启用，并自带 `removeUser`：校验管理员权限、禁止删除自己，并删除目标用户的会话、账号及用户记录（`packages/core/src/auth.ts:84`）。
- 数据库通过 `user_single_admin_unique_idx` 强制全局只有一个管理员（`packages/db/src/schema.ts:64`）；本任务不改变该模型。因此“其他管理员”当前不会实际出现，但删除服务端逻辑不按目标角色拦截。
- 上游健康当前只按 `providerRef` 聚合并直接渲染，所以显示 `source:UUID`（`apps/web/src/app/(dash)/admin/operations/page.tsx:38`、`:50`、`:128`）。执行日志已经保存 `providerName` 与 `upstreamModel` 可读快照（`packages/db/src/schema.ts:1149`、`:1152`；`packages/core/src/lib/gateway-execution/telemetry.ts:75`）。
- `getMemories()` 在进入 60 秒缓存前总会先查询并清理过期项目记忆，导致每次调用至少访问一次 Mem0，缓存命中也无法避免该等待（`packages/core/src/lib/memory/service.ts:55`、`:74-76`）。
- 设置导航的个人分组标题来自 `myConfigGroup.titleKey`；普通用户只收到个人组，管理员额外收到全局管理组（`apps/web/src/shared/nav-config.ts:50`、`:129`、`:137`）。
- 指令卡当前把前 200 个字符放进 `<pre>`，因此 Markdown 控制符直接可见（`apps/web/src/features/panel/cards/CardsManager.tsx:131-132`）；项目已有统一安全 Markdown 渲染组件可复用。
- “返回聊天”桌面与移动入口都位于 `DashSidebar`，已具备 hover 色彩反馈，但箭头没有位移反馈（`apps/web/src/shared/components/DashSidebar.tsx:137-140`、`:175-183`）。

## Requirements

- R1：账号管理提供删除入口；管理员不能删除自己，但可以删除其他任意现存账号，服务端不按目标角色拦截。删除前必须二次确认，失败时保留弹窗并显示反馈。
- R2：运维监控按“服务商 + 上游模型”维度聚合近 90 天健康数据，主要可见标识使用服务商名称和模型名，不显示 UUID；旧日志缺少名称时使用可理解的占位文案。
- R3：长期记忆读取的缓存命中不得再执行 Mem0 清理查询；缓存未命中时一次读取完成有效记忆筛选，并对过期项目记忆做尽力清理。
- R4：个人配置分组不显示“我的配置”标题或占位；管理员仍看到独立的“全局管理”标题，普通用户看不到该组。
- R5：设置中心左侧导航切换页面时，右侧内容使用 150–250ms 的淡入与轻微位移反馈；不得动画布局属性，并尊重减弱动效设置。
- R6：指令卡正文使用现有 Markdown 渲染器展示标题、段落、列表、代码等结构，不再把 Markdown 标记作为原文预览；长内容保持有界、可阅读。
- R7：“返回聊天”在 hover、键盘焦点和按下状态下提供克制的箭头位移与既有颜色反馈，导航目标不变。

## Acceptance Criteria

- [ ] AC1：管理员可删除除自己外的普通账号；自己的行不提供可执行删除入口；取消确认不产生数据变更，删除失败有可见反馈。
- [ ] AC2：健康表每行直接显示服务商名称和上游模型，统计按二者区分，主要界面不出现 provider UUID。
- [ ] AC3：同一用户在缓存有效期内重复调用 `getMemories()` 不再次访问 Mem0；过期项目记忆不进入返回结果，清理失败不导致有效记忆消失。
- [ ] AC4：普通用户侧栏无“我的配置”小字和空占位；管理员侧栏只保留“全局管理”分组标题。
- [ ] AC5：左侧导航切换后的内容过渡时长不超过 250ms，无布局抖动；减弱动效模式下近乎即时完成。
- [ ] AC6：指令卡 Markdown 被结构化渲染，长内容不撑破卡片，编辑、删除和使用次数行为保持不变。
- [ ] AC7：“返回聊天”在鼠标、键盘焦点和按下状态下有清晰反馈，移动端与桌面端都可用。
- [ ] AC8：相关单测、Web lint 与 TypeScript 类型检查通过；关键页面完成浏览器桌面/移动与减弱动效检查。

## Constraints

- 不新增依赖；复用 Better Auth admin API、`ConfirmDialog`、统一 Markdown、现有 Tailwind 动效与设计 token。
- 不新增数据库迁移，不修改账号角色管理、设置发布审计或导航 URL。
- 管理界面动效仅表达状态变化，时长不超过 250ms；静止状态不新增投影。
- 不运行 Java 全量编译；本任务不涉及 Java。

## Out of Scope

- 放开多管理员、删除设置发布历史操作者、批量删除、回收站或账号恢复。
- 修改健康探测算法、执行日志结构、保留周期或历史数据回填。
- 重做设置中心信息架构、引入动画库、Markdown 编辑器或新的卡片功能。
