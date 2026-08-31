# RAG 结构化来源设计

## Contract

在 `@nekusora/contracts/chat` 定义并复用文件级来源：

```ts
interface RagSource {
  fileId: string;
  filename: string;
  mime: string;
}
```

`packages/contracts/src/chat.ts` 中 `ChatProcessStep` 的 `kind: "rag"` 在现有 `data` 中增加可选 `sources: RagSource[]`。`isChatProcessStep` 的 `hasOnlyKeys` 同步允许 `sources`，并逐项严格校验这三个非空字符串字段；不允许 `content`、`chunkIndex`、`similarity` 或额外键。

## Backend Data Flow

```text
owned fileObjects
  -> full_context: only files actually injected
  -> rag: only files with retrieved chunks
  -> BuildContextOutput.sources (dedupe by fileId, first-hit order)
  -> orchestrator recordStep(kind=rag, data.sources)
  -> ChatProcessRecorder trace event -> SSE runtime reducer
  -> completion process_trace JSONB
  -> history/version projection
```

- `buildFullContext` 仅在文件正文实际加入 token 预算时记录来源。
- `buildRagContext` 复用现有按文件 Map，借助已通过属主查询的 `fileRows` 补齐 `mime`。
- orchestrator 更新现有 RAG step 时把 `sources` 交给 `ChatProcessRecorder.recordStep`；recorder 的既有 `trace` 事件立即进入 SSE，最终 `projectedSnapshot` 使用同一步骤数据。旧 `rag_search` 状态事件保持不变。
- 无命中、跳过或失败返回空来源，不伪造附件来源。
- 不新增表、列或独立 provenance 记录。

`packages/core/src/lib/chat/process-trace.ts` 与 `apps/web/src/features/chat/model/processTrace.ts` 的两个 `cloneStep` 在复制 `data` 时同时复制 `sources` 数组，避免实时状态、快照和版本切换共享可变引用。历史解码继续复用更新后的共享 contract guard，不增加第二份白名单。

## Private UI

- `MessageProcessTrace` 从当前 runtime 或最新历史 run 的 RAG step 读取来源。
- 来源按文件显示为可聚焦按钮，不展示分数、片段或内部状态。
- ChatComposer 把同名 `onPreviewFile` 回调依次向下传给 `ChatMessageList -> ChatMessageItem -> MessageProcessTrace`；来源按钮点击后沿该回调回到 ChatComposer 的 `setPreviewFile`。
- ChatComposer 把来源直接写入既有 `previewFile`，继续由 `FilePreviewModal` 请求 `/api/files/{fileId}`；属主鉴权仍在服务端。
- 同步中英文 next-intl 文案；不新增第二个预览组件或公开 URL。

## Share Privacy

匿名分享继续使用现有白名单投影，不返回 `processTrace`。只增加带来源 sentinel 的回归测试，断言响应中没有来源文件名、`fileId`、`mime` 或预览入口。

## Compatibility And Rollback

- `sources` 是可选 JSON 字段，旧历史和无来源记录保持原行为。
- 新 guard 允许旧 RAG data；旧客户端忽略新字段。
- 回滚 UI 或 recorder 不需要数据库迁移；已存 JSONB 中未知字段可被忽略。

## Validation

- Core context 测试覆盖全文预算、向量多 chunk 去重、无命中和敏感字段排除。
- contract/orchestrator/recorder/reducer 测试覆盖严格 allowlist、trace SSE、数组复制和实时到历史 round-trip。
- UI 测试覆盖来源去重、键盘按钮、预览回调、刷新和版本切换。
- 分享测试使用私有 sentinel 验证完全隐藏。
