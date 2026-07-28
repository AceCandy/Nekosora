# Design: 持久化并展示聊天图片附件

## Boundary

- 数据库：新增消息与文件的多对多关联，不改变 `messages.content`。
- 服务端：统一校验图片附件；普通发送原子写入用户消息与附件关联；编辑替换关联；重试从关联读取。
- 投影：`ChatMessage` 增加可序列化附件 DTO，历史主线按消息 ID 批量回填。
- 前端：上传全部成功后再加入用户消息；消息内展示图片；编辑时继承并可移除；复用现有无边框查看器。
- 不改公开分享、知识库文件治理、模型目录、图片压缩和非图片附件展示。

## Persistent Contract

新增 PostgreSQL 表：

```text
message_file_objects
- message_id text NOT NULL -> messages.id ON DELETE CASCADE
- file_id text NOT NULL -> file_objects.id ON DELETE CASCADE
- sort_order integer NOT NULL
- PRIMARY KEY (message_id, file_id)
- UNIQUE (message_id, sort_order)
- INDEX (file_id, message_id)
```

约束说明：

- 只由应用层为 `role=user` 的消息写入图片关联。
- 同一消息内 `fileId` 去重并保留客户端顺序；`sort_order` 从 0 连续递增。
- 同一文件可关联多条消息，以支持编辑后的同一用户消息和重新生成复用。
- 消息或文件物理删除只级联删除关联行；删除消息不得顺带删除 `file_objects`。
- 软删除消息保留关联，保持当前分支历史语义；不新增文件回收器。

迁移追加为 `drizzle/pg/0018_*.sql`，同步 `drizzle/pg/meta/0018_snapshot.json` 与 `_journal.json`，不改写已发布迁移。

## Runtime DTO

```ts
interface ChatMessageAttachment {
  fileId: string;
  filename: string;
  mime: string;
}

interface ChatMessage {
  // existing fields
  attachments?: ChatMessageAttachment[];
}
```

DTO 不包含 object URL、base64、存储 key 或签名 URL。渲染和查看统一使用当前用户鉴权的 `/api/files/{fileId}`。无附件时省略字段，保证旧消息兼容。

## Validation Ownership

服务端以单一附件解析函数校验客户端提交的 `fileIds`：

1. 保留输入顺序；重复 ID 只保留第一次出现的位置，并以规范化后的唯一序列继续校验和写入。
2. 一次查询全部文件，要求每个 ID 都存在。
3. 要求 `file.userId === session.user.id`。
4. 要求 `file.conversationId === body.conversationId`。
5. 要求 `mime` 为 `image/*`。
6. 图片存在时要求目标模型支持 vision；失败必须在新用户消息落库前返回。

解析结果同时供消息关联写入、模型多模态构造和响应 DTO 使用，orchestrator 不再独立重查或重新解释同一批 ID。客户端提交的 IDs 始终视为不可信。

编辑与重新生成不由客户端重新声明历史附件：

- 编辑 Server Action 接收用户在编辑 UI 中保留的附件 IDs，在会话属主锁内重新校验并替换该用户消息的关联。
- 随后的 `/api/chat` 根据 `userPublicId` 读取已持久化附件，供模型请求使用。
- 重新生成同样根据目标 assistant 的 parent user 消息读取附件。

## Send Sequence

```text
composer submit
  -> if new conversation: create conversation and migrate the empty runtime
  -> await all attachment uploads
  -> any pending/uploading/error/missing fileId: keep composer state + show error + stop
  -> all uploaded: build attachment DTOs
  -> append optimistic user message(text may be empty, attachments non-empty)
  -> POST /api/chat(text + ordered fileIds)
      -> authorize conversation
      -> validate complete attachment batch and vision capability
      -> transaction: insert user message + insert association rows
      -> prepare context from the same validated batch
      -> stream response
  -> accepted response: clear consumed composer attachments
  -> attachment/vision 4xx before stream: remove this optimistic user/assistant pair, keep composer attachments
  -> accepted stream: keep the persisted user message; later stream errors follow existing assistant error behavior
```

新会话需要先创建会话才能上传文件，这是允许的准备动作；上传失败时可留下空会话，但不得创建用户消息或附件关联。store 必须把“创建/迁移空会话”和“追加本轮乐观消息”拆开，后者只能发生在所有上传成功之后。上传失败时不得添加 user/assistant 占位，也不得调用 `/api/chat`。

服务端 attachment/vision 校验和用户消息+关联事务失败均发生在响应流创建前，返回稳定 4xx/5xx，且不会留下用户消息。客户端保存本轮追加前的 runtime 快照；这类 `res.ok === false` 响应恢复快照并保留 composer 附件。事务提交后的非附件上下文或流式失败不伪装成“未发送”：用户消息及附件已成为历史，沿用现有 assistant 错误/中断语义。

仅图片消息以 `content: ""` 保存。发送条件为“trim 后有文字，或至少一张有效图片”；二者都为空才禁止。会话标题继续使用现有空文本兜底，不在本任务重新设计标题策略。

## History Projection

`getVisibleBranch` 解析出当前主线后：

1. 收集主线用户消息内部 IDs。
2. 一次 join `message_file_objects` 与 `file_objects`，限定当前会话和当前用户。
3. 按 `message_id, sort_order` 分组为 DTO。
4. 与现有 run metadata、tool calls、feedback 一样投影到消息。

页面 SSR 映射必须保留 `attachments`。旧消息或零关联消息按纯文本返回。文件行被物理删除时外键会同时清理关联，系统无法也无需伪造已不存在的图片位置；关联和文件元数据仍存在、但底层对象读取失败时保留 DTO，由图片加载失败态处理且不阻断文字渲染。

## Edit And Regenerate

### 编辑重发

- 进入编辑态时复制当前 `attachments` 为本地草稿，不直接修改 store。
- 缩略图提供移除按钮与点击查看；本任务不增加“编辑时新增图片”。
- 提交条件：文字或附件至少一个存在，且文字或附件集合确有变化。
- `onEdit` 调用链传递附件草稿 IDs；服务端签名收敛为 `editMessage(conversationId, messagePublicId, newContent, attachmentFileIds, model, modelId?)`，以便在破坏性写入前校验 vision。
- `editMessage` 在同一个现有会话属主事务中先校验完整附件集合，再删除后代、更新文本并替换附件关联；校验失败不得改写消息树。服务端再次拒绝“空文字 + 空附件”。
- Action 返回 `{ messages, attachments }`；store 仅在 Action 成功后用结果替换用户消息，再以 `userPublicId` 发起生成。`/api/chat` 从该用户消息的已提交关联读取附件，不接收编辑附件 IDs。
- 取消编辑恢复原文本与附件，不产生服务端写入。

### 重新生成

- `retryFromMessage` 定位目标 assistant 的 parent user，并返回历史与该用户消息标识。
- `/api/chat` 在创建 assistant 占位或流之前，按该持久化用户消息批量读取关联并构造多模态输入，不依赖当前 composer 状态；`retryFromMessage` 无需把附件重新交给客户端。
- 零关联消息按纯文本消息重试；存在关联但任一文件解析/读取失败时返回附件错误，不得只用成功子集或退化为纯文本重新生成。
- 客户端保留被替换 assistant 的快照；预流式附件错误恢复原 assistant，不留下仅含错误文案的伪版本。已开始流后沿用现有中断语义。

## UI Contract

- 图片位于用户文字上方；多图使用稳定尺寸的紧凑网格，保持原顺序，不新增外层卡片、文件名表头或独立标题栏。
- 单图与多图均限制消息宽度和缩略图宽高，在 320px 视口不横向溢出；图片使用 `object-cover` 缩略展示，按钮尺寸稳定。
- 每张图片有加载占位和可感知失败态；失败只影响该图，文字和其他图片继续显示。
- 图片本身是可聚焦按钮，使用文件名作为可访问名称；点击复用 `FilePreviewModal`。
- 查看器沿用现有透明、无边框、无标题图片 dialog，支持关闭按钮、ESC、遮罩关闭与焦点行为；不复制 Markdown 图片弹窗。
- 明暗主题只使用现有设计 token，静止状态无额外投影。

## Compatibility And Rollback

- 新字段均可选，旧消息和旧 SSR 数据无需回填。
- API 的 `fileIds` 仍只用于普通新消息；编辑/重试附件改为服务端从关联读取。
- 回滚应用代码后新增表不影响旧代码；数据库回滚可单独删除关联表，因为文本消息和文件对象均未改写。
- 不删除已有文件，不迁移 `messages.content`，回滚不会丢失聊天文本。

## Failure Matrix

| 条件 | 结果 |
| --- | --- |
| 任一上传失败或仍无 `fileId` | 阻止发送，保留附件与错误态 |
| 未知、越权、跨会话、非图片 ID | 4xx，且不插入用户消息/关联 |
| 模型不支持 vision | 4xx，且不插入用户消息/关联 |
| 用户消息与关联事务失败 | 全部回滚，不开始模型请求 |
| 历史消息零关联 | 按纯文本消息显示和重试 |
| 关联存在但模型侧文件解析/读取失败 | 重试明确失败，不发送成功子集或纯文本替代请求 |
| 展示侧图片读取 401/404/加载失败 | 图片失败态，文本不受影响 |
| 编辑移除全部图片但仍有文字 | 允许，关联替换为空 |
| 编辑后文字与图片都为空 | 禁止提交 |
