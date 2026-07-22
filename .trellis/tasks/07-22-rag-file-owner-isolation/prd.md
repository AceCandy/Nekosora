# 阻止聊天与 RAG 跨用户文件读取

## Goal

阻止已认证用户通过伪造 WebChat `fileIds`、`knowledgeBaseIds`、知识库调试请求或 MCP 工具调用，让 RAG/vision 读取其他用户上传的文件内容。

## Background

- `prepareChatContext` 的图片筛选只使用 `file_objects.id IN fileIds`。
- `buildMultimodalUserMessage` 与 `buildMessagesWithFileContext` 再次查询文件时仍只按 id。
- `buildRagContext` 忽略已查询的 fileRows，把客户端原始 fileIds 直接传给 `retrieve`。
- `retrieve(query, [])` 把空数组解释为不加 where；MCP `search_knowledge` 正以此检索全库。
- `getFileIdsByKnowledgeBases` 只按客户端 kbIds 与 ragReady 过滤，知识库调试端点和 WebChat 均可收集他人文件 ID。

## Requirements

- R1：`retrieve` options 必须要求 `userId`，候选查询在 DB where 层始终包含 `file_objects.user_id = userId` 与 `rag_ready = true`；空 fileIds 仅表示当前用户全部文件。
- R2：所有 retrieve 调用方（WebChat context、知识库搜索 API、MCP）传入已认证主体 userId。
- R3：`getFileIdsByKnowledgeBases(kbIds, userId)` 必须按 `file_objects.user_id` 过滤，所有调用方传入当前用户。
- R4：`BuildContextInput` 增加 userId，fileRows 查询按 owner 过滤，RAG 分支只传查询结果中的 owned fileIds。
- R5：`buildMultimodalUserMessage` 必须接收 userId 并在自身 DB 查询中按 owner 过滤；orchestrator 的图片初筛也按 owner 过滤。
- R6：无权或不存在的 file/kb ID 静默收敛为空，不泄露资源是否存在；保持合法用户的 vision/full-context/RAG 行为不变。

## Acceptance Criteria

- [x] AC1：retrieve 单测证明指定/空 fileIds 两种路径都包含 owner + ragReady 条件。
- [x] AC2：context 单测证明 fileRows 只按 owner 查询，传给 retrieve 的仅是 owned fileIds 且 options.userId 正确。
- [x] AC3：multimodal 单测证明文件读取查询包含 owner，未查询到 owned 图片时不调用 storage.get/signedUrl。
- [x] AC4：rg/typecheck 证明所有 retrieve、KB file lookup 与 multimodal 调用方已传 userId，无旧签名遗漏。
- [x] AC5：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- 管理员跨用户审计接口；现有入口全部使用调用者自身身份。
- 文件共享或公共知识库权限模型。
- 数据库行级安全（RLS）迁移。
