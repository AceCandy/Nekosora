# 技术设计：彻底删除提示词模板和知识库

## 边界

删除两条独立能力链：

1. 提示词模板：页面/导航 → 模板服务与种子 → Chat API 字段 → `prepareChatContext` 模板渲染 → `prompt_templates`。
2. 知识库：页面/导航/调试 API → 知识库服务与文件分组 → Composer 选择及持久化 → Chat API/编排 → `knowledge_bases` 与 `file_objects.knowledge_base_id`。

保留指令卡、输出模式、渲染样式、普通文件上传、聊天附件，以及附件文件已有的全文/RAG 上下文构建。

## 代码处理

- 专属文件直接删除：模板页面/服务/类型/种子，知识库页面/服务/检索端点及 Web route。
- 共享文件只做局部删除：导航、Chat 页面、Composer、会话 Actions、Chat store/runtime、Chat HTTP handler、orchestrator、gateway handler 与 contracts route。
- Composer 快照移除 `kbIds`、`toggleKnowledgeBase`、知识库 props/type/UI；继续采用现有完整快照与 latest-only writer，不改变其他选择项语义。
- Chat 编排移除模板渲染及知识库 ID 展开；附件 `fileIds` 继续走 `buildMessagesWithFileContext`。
- 指令卡分支和 system prompt 合并顺序保持不变。

## 数据库与迁移

- 从当前 Drizzle schema 删除 `promptTemplates`、`knowledgeBases` 和 `fileObjects.knowledgeBaseId`。
- 使用现有 `drizzle-kit generate` 追加 `0001` 前向迁移及新 snapshot/journal，不修改 `0000` 历史产物。
- 在新迁移中清理 `conversations.composer_state -> 'kbIds'`，避免遗留 JSON 状态。
- `PG_BASELINE_TABLES` 继续描述 `0000_snapshot`，保留历史表名；迁移后当前 schema 由 `0001` 收敛。
- 删除结构与数据不可逆。回滚需要恢复代码并追加重建表/字段的前向迁移，已删除内容无法恢复；用户已确认产品未上线且无需保留这些数据。

## 契约同步

- 删除 `/api/knowledge/search` 的 Web、core export、gateway handler 和 contracts route，避免多运行时出现悬空路由。
- 清理 Web tsconfig/vitest 中知识库专属 alias。
- 更新前后端 Trellis 规范中 Composer 选择数量与字段列表，移除 `kbIds` 契约。

## 风险控制

- 以 `rg` 负向检查两项专属符号；对 `template`、`RAG` 等通用词不做机械全删。
- 单独回归指令卡选择/发送和普通附件上下文，防止共享编排误删。
- 检查迁移 journal `prevId`/snapshot 连续性，并执行 bootstrap 与相关定向测试。
