# Chat 导航与客户端负载治理设计

## 边界

- 服务端查询、鉴权和游标解析继续位于 `features/chat/actions/conversations.ts`。
- `app/chat/layout.tsx` 只把首屏窗口和可序列化分页信息传给 `Sidebar`。
- `Sidebar` 使用本地 state 管理已加载窗口、加载状态和当前项补入；不把服务端列表复制进 Zustand，也不引入请求状态库。
- 数据库只新增支撑会话导航排序的 PostgreSQL 索引及对应 Drizzle 迁移元数据。

## 查询契约

### 展示顺序

服务端排序必须与当前客户端分组一致：

1. 未归档且置顶；
2. 未归档且未置顶；
3. 已归档。

每组内按 `updated_at DESC, id DESC`。服务端使用分组 rank 表达式作为第一排序键，`id` 是相同时间戳的稳定 tie-breaker。客户端仍负责把第二组细分为今天、昨天、前天、周内、月内和更早，不重新排序服务端结果。

### 页面与游标

- 常量页大小为 30；查询 `LIMIT 31`，返回前 30 条和 `hasMore`，避免额外 `COUNT(*)`。
- 游标包含最后一行的 `rank`、ISO `updatedAt` 和 `id`，由服务端编码/校验；调用方不能提交任意 limit。
- 下一页严格位于完整降序排序键之后：rank 更大，或同 rank 下 `updatedAt` 更小，或二者相同且 `id` 更小。
- 客户端按 ID 合并用于抵御重复点击/响应重放，但正确性依赖服务端严格游标，而不是客户端去重。按 ID 补入的当前项也必须依完整排序键插入，不能简单追加后破坏组内顺序。
- 并发新增或更新时间上移的会话可能移动到已消费边界之前，本轮“加载更多”不回填它；后续 `router.refresh()` 从新首屏重置。这是无快照游标的明确语义，避免长期事务或快照令牌。
- 已删除行自然消失；删除已加载项后刷新窗口。到达末尾后禁用继续加载，不再发请求。

### 当前会话

`Sidebar` 已能从 pathname 得到当前会话 ID。若首屏和后续已加载窗口均不含该 ID，则调用属主隔离的单项 Server Action 获取导航投影，并按完整排序键插入本地集合；不存在或无权访问时返回 `null`。这样 `/chat/[id]` 深链不要求扩大首屏窗口，也不暴露其他用户数据。

乐观新会话仍由现有 `optimisticConversation` 注入。服务端页面后续包含同 ID 时沿用现有覆盖标题逻辑。

## 状态与交互

- 首屏直接显示服务端结果，无额外 loading。
- “加载更多”位于滚动列表末尾，使用现有按钮视觉、`touch-target` 和可见焦点；请求中显示不改变几何尺寸的加载状态，并设置 `disabled`/`aria-busy`。
- 慢网络时保留已有列表，不用覆盖式 spinner；失败后恢复可重试按钮，不清空列表。
- 置顶、归档、删除和重命名继续通过现有 mutation + `revalidatePath` 刷新服务端窗口；本任务不增加复杂乐观重排。
- 搜索继续调用 `searchMessages`，独立于已加载窗口。
- 移动抽屉现有开关、遮罩和导航后关闭行为不改变。

## 生成状态

将 `getGeneratingStatuses` 的数据源收敛为当前用户仍有效的活动 run，并按会话 ID 去重，只返回 `{ id, generating: true }`。Chat layout 在首屏同时取得这组活动 ID 并交给 Sidebar，轮询启动条件基于活动 ID 集合而不是首屏 30 条中的 `generating` 字段，确保后页活动会话仍可被跟踪。Sidebar 将上一轮存在、本轮缺失的 ID 视为完成，维持蓝点和 `router.refresh()` 行为；只有已加载项显示转圈或完成蓝点。查询从有效 run 出发并通过 conversations 做属主隔离，复用现有 `runs_active_conversation_idx`，不扫描全部历史会话。

## 索引与迁移

新增会话导航复合/表达式索引，首列为 `user_id`，其余键匹配 rank、`updated_at DESC`、`id DESC`。追加新的 PostgreSQL 迁移（当前最新为 `0012`，实际文件名由 Drizzle 生成器决定），不改写既有迁移；同步 `schema.ts`、Drizzle journal 与 snapshot。若 Drizzle 声明式 API 无法准确表达 rank 表达式，则迁移中创建表达式索引，并在 schema 测试中以 SQL/迁移契约覆盖，不能降级为不匹配排序的装饰性索引。

## 客户端依赖结论

- `ArtifactPanel` 已动态加载 Prism。
- `MermaidDiagram` 已在 effect 中动态导入 Mermaid。
- 结构化图表已动态加载 Recharts。
- Markdown 静态加载 Streamdown 与 `@streamdown/code`，但它是聊天正文核心路径。

现有 `.next/static/chunks` 最大文件约 780 KB，但没有 bundle analyzer，无法把 route 首屏成本可靠归因到 Markdown/Shiki。当前证据不足以证明再拆包有净收益，因此本任务保留 Markdown 边界；只有后续获得可归因的 route bundle 与前后交互数据时再单独实施。

## 兼容、回滚与风险

- API 仅由同仓 Server/Client 组件调用，无外部兼容面；旧 `listConversations()` 调用点需一次性迁移到页面结果。
- 主要风险是排序表达式、游标谓词和索引不一致；测试必须覆盖同时间戳、跨分组、删除和并发更新边界。
- 当前项补入可能短暂晚于首屏 hydration；用固定高度加载占位避免列表跳动，并通过慢网络浏览器验证。
- 回滚可撤销 UI/action 改动并追加迁移删除索引；已发布迁移文件本身不得改写。
