# 为 RAG 增加结构化来源

## Goal

让用户能够识别附件 RAG 回答使用了哪些私有文件，同时保持流式、历史刷新和匿名分享的隐私语义一致。

## Background

- `retrieve.ts:32-38,179-191` 已在 `RetrievedChunk` 中保留 `fileId`、`filename`、`chunkIndex`、`content` 和 `similarity`。
- `context.ts:101-126` 当前只拼接文件名和正文，`BuildContextOutput` 不返回结构化来源。
- 消息的 `process_trace` 已是 JSONB；completion 与历史分支已有统一持久化和投影链路，不需要新表。
- `MessageProcessTrace` 已有独立来源 disclosure，可复用其信息架构；私有文件预览已有属主鉴权的 `FilePreviewModal`。
- 匿名分享当前不返回 `processTrace` 或私有附件，默认不会暴露 RAG 来源。

## Requirements

- R1：全文模式与向量模式都生成文件级 allowlist 来源，仅包含预览所需的 `fileId`、`filename` 和 `mime`；不得写入 chunk 正文、`chunkIndex` 或 `similarity`。
- R2：来源沿现有 chat process contract 进入实时客户端状态和最终 `processTrace`，刷新、版本切换后保持一致。
- R3：同一文件的多个命中在 UI 中合并展示，不把内部 similarity 作为面向用户的排序分数。
- R4：私有文件打开继续复用 `/api/files/{fileId}` 的属主鉴权和 `FilePreviewModal`，不生成公开 URL。
- R5：匿名分享完全隐藏 RAG 来源，不返回文件名、`fileId`、`mime` 或私有文件入口。
- R6：扩展 JSON 合约而非新增数据库列或 provenance 表；未知新字段对旧历史保持兼容。

## Acceptance Criteria

- [ ] 向量 RAG 和全文注入均产出结构化来源；无命中、无附件和旧历史保持原行为。
- [ ] 当前轮生成结束时来源可见，刷新页面和切换回答版本后内容一致。
- [ ] 来源 disclosure 按文件去重，文件名可读，内部片段正文和 similarity 不直接显示。
- [ ] 私有预览继续执行属主校验，伪造或他人 `fileId` 无法读取。
- [ ] 匿名分享不渲染或返回 RAG 来源，响应中不包含来源文件名、`fileId` 或私有文件入口。
- [ ] 不新增 PostgreSQL migration，现有 `process_trace` JSONB 兼容旧记录。
- [ ] 定向测试覆盖来源映射、SSE/运行时、持久化历史、版本切换、UI 和分享隐私。

## Out of Scope

- 保存或展示完整检索 chunk、原始 embedding、公开 similarity 分数。
- 匿名分享文件下载、带过期凭据的 share-bound 文件访问。
- 知识库管理、跨会话来源索引或独立 provenance 查询。
