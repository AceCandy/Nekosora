# 技术设计

## Change Boundary

当前行为缺口分布在七个既有入口，但都能在数据真实来源或共享壳层一次修正：账号删除走 Better Auth admin API；健康展示直接使用执行日志已有快照；记忆性能修正在共享读取服务；导航标题与页面过渡修在共享设置壳；指令卡复用统一 Markdown；返回按钮只调整既有链接反馈。

不修改数据库 schema、路由、权限模型、健康算法、记忆业务语义或指令卡 CRUD。没有必要建立父子任务树：各项改动虽可独立验证，但实现均为同一 Web/Core 体验修整，单任务更易做最终集成复核。

## Data Flow

### 账号删除

`DeleteUserButton` → `ConfirmDialog` → 绑定的 Server Action → `requireAdmin()` 与本人 ID 校验 → `auth.api.removeUser({ userId })` → Better Auth 删除会话/账号/用户并触发数据库级联 → `revalidatePath("/admin/users")`。

- UI 通过 `listUsers()` 返回的 `isCurrent` 标识隐藏本人删除入口。
- 服务端再次拒绝本人 ID，不能依赖 UI 作为授权。
- 目标角色不参与判断；当前单管理员唯一索引保持不变。

### 健康聚合

`gateway_executions` 的 `providerRef`（稳定分组键）、`providerName`（可读快照）、`upstreamModel`（上游模型快照）→ 近 90 天 SQL 聚合 → 表格显示服务商与模型两列。

- 分组保留 `providerRef`，避免同名服务商被错误合并；显示层只使用 `providerName`。
- 模型使用 `upstreamModel`，旧记录缺失时回退请求模型字段。
- 名称缺失时显示本地化“未知服务商”，不回退 UUID。

### 长期记忆读取

`getMemories(userId)` → `cacheWrap(memories:userId)` → 仅缓存未命中时调用一次 `memory.getAll(showExpired:true)` → 按现有日期规则分离有效/过期项目记忆 → 尽力删除过期项 → 缓存有效结果。

- 删除清理失败不影响有效记忆返回。
- 写操作继续通过现有 `invalidateMemoryCache()` 保证读后更新。
- 这样既保留懒清理语义，也让缓存命中真正零 Mem0 调用。

### 设置与卡片交互

- 去掉 `myConfigGroup.titleKey`；角色过滤仍由 `panelNavGroups()` / `adminNavGroups()` 唯一负责。
- 使用 Next.js 原生 `(dash)/template.tsx` 包裹右侧页面内容，以既有 `animate-in` 工具做 200ms 淡入 + 轻微上移；`motion-reduce` 关闭位移动画。
- 指令卡用现有 `Markdown` 静态渲染，外层限制高度与滚动，不新增解析器或危险 HTML 路径。
- `DashSidebar` 两个返回链接复用项目已有 group-hover 箭头位移模式，不新增动态图标组件。

## Compatibility And Rollback

- URL、Server Action 调用方式、日志表与缓存键保持兼容。
- 旧健康日志可通过请求模型与未知服务商占位继续展示。
- 每项均为局部文件修改；回滚可按账号、监控、记忆或 UI 文件独立撤销。
- 唯一需要关注的运行时边界是 Better Auth Server API 的 headers 透传，需用单测与实际路由访问验证。

## Expected Files

- `apps/web/src/app/(dash)/admin/actions.ts`：账号列表本人标识与删除 Server Action。
- `apps/web/src/app/(dash)/admin/actions.test.ts`：本人保护与 Better Auth 删除调用测试。
- `apps/web/src/app/(dash)/admin/users/page.tsx`、同目录小型客户端删除按钮组件：表格操作列与确认反馈。
- `apps/web/src/app/(dash)/admin/operations/page.tsx`、`page.test.ts`：供应商 + 模型聚合和回归断言。
- `packages/core/src/lib/memory/service.ts`、`service.test.ts`：单查询缓存边界、过期过滤和失败降级。
- `apps/web/src/shared/nav-config.ts`、`nav-config.test.ts`：移除个人分组标题并锁定角色行为。
- `apps/web/src/app/(dash)/template.tsx`：右侧页面原生路由过渡。
- `apps/web/src/features/panel/cards/CardsManager.tsx`：统一 Markdown 预览。
- `apps/web/src/shared/components/DashSidebar.tsx`：返回聊天微交互。
- `apps/web/messages/zh-CN.json`、`en.json`：删除、健康表头与占位文案。

## Explicitly Not Doing

- 不借此拆分 `admin/actions.ts`、重构整张用户表或创建通用删除框架。
- 不给健康数据新增 DTO/服务层；查询只有该页面一个消费者。
- 不新增全局动效状态、动画依赖或卡片专用 Markdown 解析器。
