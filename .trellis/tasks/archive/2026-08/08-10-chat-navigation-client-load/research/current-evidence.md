# 当前证据

## 会话导航

- `apps/web/src/features/chat/actions/conversations.ts:107-123`：`listConversations` 查询当前用户全部会话，只按 `updatedAt DESC`，无 limit、稳定 tie-breaker 或游标。
- `apps/web/src/app/chat/layout.tsx:20-55`：Chat layout 加载完整列表、将 Date 映射为数字并序列化给 Sidebar。
- `apps/web/src/features/chat/components/Sidebar.tsx:293-354`：客户端合并乐观新会话，再按归档、置顶和时间桶分组。
- `apps/web/src/features/chat/components/Sidebar.tsx:167-180`：当前项由 pathname 优先、Zustand active ID 回退确定。
- `apps/web/src/features/chat/components/Sidebar.tsx:242-256` 与 action `268-309`：全文搜索是独立 Server Action，300ms 防抖，服务端最多返回 50 条，不依赖侧栏列表。
- `packages/db/src/schema.ts:337-360`：conversations 只有 `user_id` 索引，没有匹配导航排序的复合索引。

## 行为约束

- `Sidebar.tsx:192-240`：只要首屏列表含 generating 会话，每 6 秒调用 `getGeneratingStatuses`；当前 action 会扫描用户全部会话。
- `Sidebar.tsx:279-317`：删除当前会话后回 `/chat`；乐观新会话在 SSR 缺失时插入列表头，存在时覆盖可能过期的 SSR 标题。
- `Sidebar.tsx:482-498`：移动端使用遮罩与 transform 抽屉，分页控件不能破坏该滚动容器和关闭行为。
- `conversations.test.ts:82-126`：当前 action 测试覆盖 generating 投影，但不覆盖分页、稳定排序或游标。

## 客户端加载边界

- `apps/web/src/features/artifacts/ArtifactPanel.tsx:22-29`：Prism 已通过 `next/dynamic` 且 `ssr: false` 延迟加载。
- `apps/web/src/shared/components/mermaid/MermaidDiagram.tsx:69-95`：Mermaid 只在 effect 中动态导入。
- `apps/web/src/shared/components/structured-blocks/index.tsx:15`：Recharts 已有动态边界。
- `apps/web/src/shared/components/markdown/Markdown.tsx:24-31`：Streamdown 与 `@streamdown/code` 静态导入，属于普通 AI 回复核心路径。
- 当前 `apps/web/.next/static/chunks` 最大文件约为 780 KB、656 KB、622 KB、523 KB；项目没有 bundle analyzer，文件文本命中不能可靠证明 route 首屏归因。

## 结论

- 采用服务端稳定键集游标与固定首屏窗口，避免 offset 在删除和并发更新下漂移。
- 当前深链项单独按 ID 补入，不能靠扩大首屏或加载全部历史保证可见。
- 活动状态查询应从有效 run 出发，不再投影全部历史会话；首屏需单独携带活动 ID，避免分页列表错误关闭轮询。
- 已有重型可选渲染器多数已动态加载；缺少可归因收益证据时保留核心 Markdown 现状。
