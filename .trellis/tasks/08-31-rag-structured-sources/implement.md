# RAG 结构化来源实施计划

## Step 1: Lock The Contract

- 在 `packages/contracts/src/chat.ts` 为 RAG step 增加文件级 `RagSource`，同步 `hasOnlyKeys` 与逐项 guard 测试。
- 增加敏感字段拒绝用例，确认 chunk 正文、索引和相似度不能进入快照。

## Step 2: Produce Sources

- 扩展 `BuildContextOutput`。
- 全文模式只记录实际注入的文件；向量模式按现有文件 Map 去重并补齐 mime。
- orchestrator 通过既有 `ChatProcessRecorder.recordStep` 把来源写入 RAG step，使同一 data 同时进入 trace SSE 与最终快照；不创建新事件或持久表。
- Core/Web 两个 `cloneStep` 复制嵌套来源数组，历史解码继续使用共享 guard。
- 补 orchestrator/recorder 测试，断言来源在终态前通过 trace event 发出，并与最终 snapshot 一致。

Verify:

```bash
pnpm --filter @nekusora/core exec vitest run src/lib/rag/context.test.ts src/lib/chat/process-trace.test.ts
pnpm --filter @nekusora/web exec vitest run src/features/chat/model/processTrace.test.ts
```

## Step 3: Render Private Sources

- ChatComposer 以 `onPreviewFile` 向下经过 ChatMessageList、ChatMessageItem 传到 MessageProcessTrace。
- 在 `MessageProcessTrace` 的来源 disclosure 渲染文件按钮。
- 复用 ChatComposer 的 `previewFile` 与 `FilePreviewModal`。
- 同步中英文文案和组件测试。

## Step 4: Lock Share Privacy

- 在 `share.test.ts` 放入来源文件名、ID、mime sentinel。
- 断言匿名分享投影完全排除 `processTrace` 与来源入口。

## Step 5: Quality Gate

```bash
pnpm --filter @nekusora/contracts typecheck
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/web typecheck
pnpm --filter @nekusora/core exec vitest run src/lib/rag/context.test.ts src/lib/chat/process-trace.test.ts
pnpm --filter @nekusora/web exec vitest run src/features/chat/model/processTrace.test.ts src/features/chat/components/ChatMessageItem.test.tsx src/features/chat/components/ChatMessageList.test.tsx src/features/chat/components/ChatComposer.test.tsx src/features/chat/actions/share.test.ts
git diff --check
```

独立复核实时/历史/版本链、属主预览和匿名分享隐私。

## Rollback Point

contract 可选字段、Core 生产、Web 展示可按层回滚；无数据库迁移。
