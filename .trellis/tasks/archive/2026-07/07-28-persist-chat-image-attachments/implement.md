# Implement: 持久化并展示聊天图片附件

## Success Criteria

- 图片与用户消息形成持久、可鉴权、稳定排序的关联。
- 普通发送、刷新恢复、编辑重发、重新生成看到并使用同一附件集合。
- 任一上传或服务端附件校验失败时，不产生用户消息且不降级为纯文本请求。
- 图片消息 UI 复用现有无边框查看器，并通过针对性测试与独立复核。

## Checklist

1. [ ] 数据库契约
   - 在 `src/db/schema/pg.ts` 新增 `message_file_objects` 及关系、约束和索引。
   - 生成并核对 `0018` PostgreSQL 迁移、journal 与 snapshot。
   - 添加迁移契约测试和级联/复用数据库测试。

2. [ ] 服务端附件解析与持久化
   - 新增单一附件解析/批量投影边界，统一所有权、会话、MIME、顺序与完整性校验；重复 ID 保留首次出现项。
   - 调整 `/api/chat` 普通发送时序：先完成附件与 vision 校验，再在消息写事务中插入用户消息和关联。
   - 让 orchestrator 消费已验证附件批次，避免重复查询和持久化/模型上下文分叉。
   - 覆盖未知、越权、跨会话、非图片、部分缺失、模型不支持和事务回滚测试。

3. [ ] 历史 DTO 与分支恢复
   - 扩展 `ChatMessage` 的 `attachments` DTO。
   - 在 `getVisibleBranch` 对主线用户消息一次批量回填附件，并在 SSR 映射中保留字段。
   - 补无附件、多附件、排序、缺失关联、属主隔离和无 N+1 测试。

4. [ ] 发送状态机与仅图片消息
   - 上传 hook 暴露可等待的完整附件结果，任一失败时抛出/返回明确失败，不只返回成功子集。
   - 新会话先创建并迁移空 runtime；将乐观 user/assistant 创建移动到全部上传成功之后，并携带附件 DTO。上传失败允许保留空会话，但 store 中不得出现本轮消息。
   - 允许“文字为空但有图片”，禁止“文字和图片都为空”；覆盖 API 接受一条 `content: ""` 的 user 消息、parent 计算及空标题兜底，保持纯文本路径不变。
   - 仅在服务端接受请求后清理已消费附件，失败时保留可重试状态。
   - 对预流式附件/vision 非成功响应恢复追加前 runtime 快照；流开始后的失败保持已持久化 user 与现有 assistant 错误语义。
   - 覆盖 pending/uploading/error、部分失败、仅图片、普通文本、空会话副作用和预流式回滚测试。

5. [ ] 编辑重发与重新生成
   - 编辑态从消息 DTO 复制附件草稿，支持预览与移除；`onEdit` 调用链传递保留的 file IDs，取消不改 store。
   - 将 action 明确定义为 `editMessage(conversationId, messagePublicId, newContent, attachmentFileIds)`；在现有事务中先校验附件，再原子更新消息树与关联并返回 `{ messages, attachments }`，服务端拒绝全空输入。
   - `/api/chat` 对 edit/retry 的 `userPublicId` 从数据库读取附件；重新生成不从 composer 或客户端 body 获取历史附件。
   - 对重新生成的预流式附件错误恢复原 assistant 快照；零关联按纯文本重试，存在关联但文件不可读时整体失败。
   - 覆盖默认继承、移除一张、移除全部但保留文字、仅图片编辑、空提交拒绝、Action 校验失败不改消息树、重试复用和附件不可读失败。

6. [ ] 用户消息图片与查看器
   - 在 `ChatMessageItem` 的用户消息中于文字上方渲染图片缩略图、加载态和失败态。
   - 点击复用 `FilePreviewModal`；不新增图片标题栏、边框容器或第二套 modal。
   - 验证多图顺序、键盘触发/关闭、明暗主题和 320px 视口无溢出。
   - 保证附件变化触发折叠测量，且纯图片消息不产生空文本气泡。

7. [ ] 独立复核与回归
   - 按 `design.md` 的 Failure Matrix 逐项复核跨层数据流和授权边界。
   - 搜索所有 `ChatMessage` 构造与历史投影，重点覆盖 SSR hydrate、普通发送、编辑结果和 assistant 版本切换，确认附件字段不会被静默丢弃。
   - 检查 diff 只覆盖本任务；确认未修改分享、模型目录、图片压缩或知识库生命周期。

## Validation

实现阶段先运行按改动文件收敛的 targeted tests，最终建议执行：

```bash
pnpm exec vitest run \
  src/lib/chat/message-attachment-migration.test.ts \
  src/lib/chat/message-attachments.test.ts \
  src/lib/chat/orchestrator.test.ts \
  src/features/chat/actions/branch.test.ts \
  src/features/chat/store/chatStreamStore.test.ts \
  src/features/chat/components/ChatMessageItem.test.tsx \
  src/shared/components/file-preview/FilePreviewModal.test.tsx
pnpm exec tsc --noEmit
git diff --check
```

前端实现后使用浏览器验证桌面与 320px 视口、明暗主题、仅图片消息、图片+文字、多图、加载失败、点击查看、ESC/遮罩/关闭按钮、编辑移除及刷新恢复。若启动服务，验证完成后关闭。

其中 `message-attachment-migration.test.ts` 与 `message-attachments.test.ts` 为计划新增测试；其余命令指向现有测试文件并追加覆盖。浏览器矩阵属于人工/自动化浏览器验收证据，不替代单元与集成测试。

JavaScript/TypeScript 测试和类型检查不涉及 Java 全量编译限制。`pnpm build` 仅在 targeted tests/typecheck 暴露 bundling 风险或用户另行批准时执行。

## Review Gates

- Gate 1：迁移、schema、journal、snapshot 和 DB 测试一致后再接 API。
- Gate 2：服务端验证、事务与历史投影通过后再接前端，避免 UI 建立在不稳定 DTO 上。
- Gate 3：前端测试通过后进行独立代码复核和浏览器验收。
- Gate 4：全部 AC 有对应测试或人工验证证据后，才进入 finish/commit/archive。

## Rollback

1. 回退前端附件 DTO、渲染和编辑交互，纯文本消息仍可工作。
2. 回退 API/orchestrator/branch 的附件读取与关联写入，保留原文本路径。
3. 最后删除 `message_file_objects` 表迁移；该表只保存关联，不包含聊天文本或文件本体。
