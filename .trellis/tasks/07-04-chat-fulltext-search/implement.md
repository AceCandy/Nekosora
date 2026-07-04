# Implement: Chat 全文搜索

## 有序步骤
1. `conversations.ts`：新增 `searchMessages(keyword)`（join conversations 属主过滤 + isNull(deletedAt) + like content + limit 50）+ `makeSnippet` helper。
2. `Sidebar.tsx`：加 `searchResults` state + `useEffect` 防抖（query 非空调 `searchMessages`）；列表区 query 非空时渲染结果（标题 + 高亮片段 + 跳转链接），空时回退原 groups。
3. i18n：searchEmpty / searchResultsHint 等 key（zh+en）。

## 验证
- `pnpm check` 必过
- 手动：输入关键词命中消息正文；点击结果跳转到对应会话；软删消息不出现在结果

## 回滚点
- 纯代码，无迁移；搜索 action 可单独移除
