# MAGI 项目进化第 16 轮

## Goal

修复文件上传接口信任客户端 `conversationId`、允许当前用户把自己的文件记录关联到其他用户会话的问题，确保会话关联只能指向当前登录用户拥有的会话，并在拒绝非法关联时不产生存储、数据库写入或处理任务副作用。

## Background

- `src/app/api/upload/route.ts:54-55` 直接读取客户端提交的 `conversationId`。
- `src/app/api/upload/route.ts:65-88` 当前先把文件写入 StorageDriver，再把该 ID 写入 `file_objects.conversationId`，没有校验会话属主。
- `src/db/schema/pg.ts:555-564` 只通过普通外键保证会话存在；外键不能保证 `file_objects.user_id` 与目标会话的 `user_id` 相同。
- 当前生产代码没有按 `fileObjects.conversationId` 读取文件的路径，因此已确认影响是跨用户关系污染；本轮不把它夸大为直接文件内容泄露。
- `conversationId` 为空字符串时，现有行为是上传成功并写入 `null`，该兼容行为必须保留。

## Requirements

- 非空 `conversationId` 必须同时按会话 ID 和当前登录用户 ID 校验属主，只有当前用户拥有的会话才能建立文件关联。
- 不存在的会话与其他用户拥有的会话必须使用相同的 403 响应和“会话不存在或无权访问”文案，避免泄露会话是否存在。
- 非法会话关联必须在获取 StorageDriver、写入文件对象、插入 `file_objects`、获取或投递队列以及同步 fallback 之前被拒绝。
- 空 `conversationId` 必须跳过会话查询，继续完成上传，并写入 `conversationId: null`。
- 合法会话上传、文件大小限制、文件名清洗、存储写入、数据库失败补偿、队列投递与同步 fallback 的既有行为保持不变。
- 回归测试必须覆盖当前用户会话、其他用户会话、不存在会话和空会话 ID，并证明拒绝路径没有后续副作用。
- 更新文件存储规范，明确任何由客户端提供的可选会话关联都必须先完成属主校验。

## Acceptance Criteria

- [x] 当前用户拥有的非空会话 ID 上传成功，属主查询同时包含会话 ID 与当前用户 ID，文件记录保留该 `conversationId`。
- [x] 其他用户的会话 ID 返回 403 和统一文案，且 StorageDriver、文件插入、队列与同步处理均未触达。
- [x] 不存在的会话 ID 与其他用户会话表现一致，不泄露存在性，也不产生任何后续副作用。
- [x] 空会话 ID 不执行会话属主查询，上传成功并写入 `conversationId: null`。
- [x] 数据库获取或属主查询失败发生在文件存储前；文件记录插入失败仍删除已经写入的存储对象并抛出原始异常。
- [x] 既有上传限制、清洗、补偿和处理 fallback 测试不回归。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 与 Trellis 校验通过，独立复核无阻塞项。

## Out Of Scope

- 修改 PostgreSQL schema、增加复合外键或迁移历史 `file_objects` 数据。
- 新增跨路由共享的会话授权 helper；本轮只有一个新调用点。
- 改造聊天接口、会话 actions 或知识库文件关联。
- 新增文件按会话读取能力，或处理尚无证据表明存在的直接文件泄露路径。
- 修复 `conversations.generating` 并发误清、Embedding 缓存失效、后台 worker 重试策略或 `generateChat` 参数不对称。

## Risks And Deferred Items

- 属主校验与文件插入之间仍可能发生会话删除；现有外键会让插入失败，既有存储补偿路径会删除已写对象，因此不会留下成功的悬空关联。
- 本轮不会自动清理历史跨用户关系；若需要修复存量数据，应先定义识别、审计和恢复策略后另立任务。
- 测试使用数据库链式 mock 验证查询约束和副作用边界，不连接真实 PostgreSQL；剩余风险主要是 ORM mock 与真实驱动行为差异，由类型检查和现有 Drizzle 用法约束。
