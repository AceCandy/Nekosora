# RAG 文件属主隔离设计

## Trust Boundary

```text
WebChat fileIds / knowledgeBaseIds ─┐
Knowledge search kbIds ─────────────┼─ untrusted IDs
MCP search_knowledge (no fileIds) ──┘
                    │
                    ▼ authenticated userId
file_objects.user_id owner filter (every DB read)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
vision storage read       full-text / vector chunks
```

## Contracts

- `retrieve(query, fileIds, { userId, ...opts })`：userId 必填；`fileIds=[]` 是当前用户全部 ragReady 文件。
- `getFileIdsByKnowledgeBases(kbIds, userId)`：KB id 即使属于他人，也只能返回 userId 自己的 file rows。
- `BuildContextInput.userId`：初始 fileRows 过滤 owner，RAG 只使用这些 rows 的 ID。
- `buildMultimodalUserMessage(text, imageFileIds, userId)`：即使被未来调用方直接调用，也不会读取他人 storagePath。

## Defense In Depth

orchestrator 初筛避免把未授权 ID 传播到能力/上下文链；context、multimodal 和 retrieve 各自在拥有真实 DB/storage 读取的边界重复 owner 条件。不能只依赖前端附件列表或会话 conversationId，因为 API body 可直接伪造。

## Compatibility / Rollback

没有 schema/API response 变化。合法用户结果不变；非法 ID 变为不可观察的空结果。回滚仅涉及函数签名与 where 条件，无数据迁移。
