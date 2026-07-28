# 当前图片附件数据流研究

## 结论

当前现象不是图片上传失败，也不是 AI SDK 多模态转换回归。图片文件已上传，首轮请求也能进入模型，但 `fileIds` 只存在于本轮 `/api/chat` 请求中；消息 store、数据库消息、历史 DTO 和用户消息组件都没有附件字段，因此发送后、刷新后、编辑重发和重新生成均无法恢复图片。

推荐新增 `message_file_objects` 关联表，保持 `messages.content` 的现有文本语义。关联表支持一张图片被原消息、编辑后的同一消息和重新生成复用，并提供外键、稳定顺序与批量查询能力。

## 已核验链路

### 普通发送

- `src/features/chat/hooks/useChatAttachments.ts` 上传 `/api/upload`，得到 `fileId`。
- `src/features/chat/store/chatStreamStore.ts` 创建的乐观用户消息只有 `role/content/createdAt`；附件只作为请求顶层 `fileIds` 发送。
- `src/app/api/chat/route.ts` 插入用户消息时只保存 `content`。
- `src/lib/chat/orchestrator.ts` 按 `fileIds` 查询文件并构造多模态消息，因此图片只对首轮模型调用可见。

### 历史恢复与分支

- `src/features/chat/actions/branch.ts#getVisibleBranch` 已有 run metadata、tool calls 和 feedback 的批量回填模式，可按相同方式批量回填消息附件。
- `src/app/chat/[id]/page.tsx` 映射历史消息时未投影附件。
- `retryFromMessage` 和 `editMessage` 返回的历史只有 `{ role, content }`。
- `regenerate` 与 `editAndResend` 请求均未传附件。重新生成应由服务端依据目标用户消息的已持久化关联读取附件，而不是信任客户端重新声明。

### 图片查看

- `src/shared/components/file-preview/FilePreviewModal.tsx` 已提供附件查看器：图片模式是透明、无边框、无标题栏的原生 dialog，内部读取 `/api/files/{fileId}`。
- `src/shared/ui/Modal.tsx` 已提供 ESC、焦点约束和遮罩关闭。
- `src/app/api/files/[fileId]/route.ts` 已按当前用户校验文件属主，并在读取边界生成私有存储签名 URL 或代理文件流。
- 用户消息应直接复用 `FilePreviewModal`，不新增带表头的图片弹窗。

## 数据模型比较

| 方案 | 优点 | 问题 | 结论 |
| --- | --- | --- | --- |
| `message_file_objects` 关联表 | 外键完整性、稳定排序、可反查、支持复用 | 增加一次迁移和关联查询 | 采用 |
| `file_objects.message_id` | 字段少 | 一张文件只能属于一条消息，无法自然复用 | 不采用 |
| `messages.content` 内嵌 IDs | 无新表 | 无外键、混入文本语义、清理与查询不可靠 | 不采用 |

## 约束与风险

- `file_objects.conversation_id` 只能说明文件属于会话，不能推断属于哪条消息，不能用于历史回填。
- 消息软删除不会触发外键级联；关联保留与当前可恢复的历史/分支语义一致。消息物理删除或文件物理删除时关联应由外键清理。
- 文件实体不随消息删除，本任务不引入孤儿文件回收。
- 当前 store 在上传完成前就插入乐观用户消息，并允许上传失败后只返回成功的 IDs；实现必须调整顺序，任何附件失败时不得进入消息 store 或 `/api/chat`。
- 当前发送入口要求非空文本；仅图片消息需要同时调整 composer 与 store 的可发送条件。

## 目标测试面

- 迁移 SQL、Drizzle journal/snapshot、复合主键、排序唯一约束和双向级联。
- 同消息多图、同文件复用、消息/文件物理删除级联、软删除保留关联。
- 上传中、上传失败、部分失败时阻止发送；仅图片消息允许发送。
- 首轮消息关联原子写入；附件越权、跨会话、非图片和未知 ID 在写消息前拒绝。
- 历史批量投影、缺失文件降级、编辑继承/移除、重新生成复用。
- 消息缩略图、加载/失败态、无边框查看器、键盘关闭、明暗主题和 320px 窄屏。
