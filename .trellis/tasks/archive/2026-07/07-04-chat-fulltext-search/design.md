# Design: Chat 全文搜索

## 决策
- 用 **LIKE**（兼容 pg jsonb 隐式转 text + sqlite text），不上 FTS5/tsvector（两套 DB 分别建索引/触发器成本高，MVP 用 LIKE 足够；后续消息量大再优化）。
- 搜 `messages.content` + join `conversations` 校验属主；排除软删（`deletedAt is null`）。
- 前端侧栏：query 非空时防抖调 `searchMessages`，结果替换列表区显示（按会话聚合并展示命中片段）；query 空时回退原 title 分组列表。

## 后端契约
`searchMessages(keyword)`：
- join conversations，`where(and(eq(conv.userId, user.id), isNull(msg.deletedAt), like(msg.content, '%kw%')))`
- orderBy desc(createdAt)，limit 50
- 返回 `{ conversationId, conversationTitle, messagePublicId, snippet, createdAt }[]`
- snippet：keyword 前后 ~30 字符，省略号标记截断

## 前端
- Sidebar 已有 `query` state；新增 `searchResults` state + `useTransition` 防抖（300ms）调 `searchMessages`
- query 非空 → 渲染结果列表（会话标题 + 命中片段，点击 `Link /chat/[id]`）；空 → 原 groups
- 片段中 keyword 用 `<mark>` 高亮（前端，大小写不敏感）

## 受影响文件
- `conversations.ts`：新增 `searchMessages` + `makeSnippet` helper
- `Sidebar.tsx`：搜索状态扩展 + 结果渲染分支
- i18n：searchHint / noResults 等

## 风险与回滚
- LIKE 在 jsonb 上全表扫描，消息量大时慢 —— MVP 可接受，design 标注后续 FTS 优化
- content 为 OpenAI 消息格式（多为 string），LIKE 匹配字符串字面量可命中
- 纯代码改动，无迁移，可回滚
