# Technical Design

## Boundary

改动限定在 `src/app/api/upload/route.ts` 的上传授权顺序、`src/app/api/upload/route.test.ts` 的回归测试，以及 `.trellis/spec/backend/file-storage.md` 的会话关联契约。

不修改数据库 schema、StorageDriver、队列、文件处理 worker、聊天接口、会话 actions 或前端。

## Authorization Contract

完成 session、multipart、文件存在性和大小校验后，先获取数据库与 schema。对非空 `conversationId` 执行一次组合条件查询：

```text
conversations.id = conversationId
AND conversations.userId = session.user.id
```

查询只需返回会话 ID。结果为空时统一返回 403：

```json
{ "error": "会话不存在或无权访问" }
```

组合查询同时表达资源存在性与属主权限，foreign 与 missing 都落到同一空结果，不需要先查存在、再在应用层比较 owner。

空字符串表示“不关联会话”，跳过属主查询并沿用 `conversationId || null` 的落库语义。

## Data Flow

```text
session -> multipart -> file/type/size validation
  -> getDb + getSchema
  -> conversationId non-empty?
       yes -> select conversation by id AND userId
                -> missing/foreign: return 403
       no  -> skip conversation query
  -> allocate file metadata + read buffer
  -> getStorage + put
  -> insert file_objects with the same db instance
       -> insert failure: delete stored object, rethrow original error
  -> queue send or synchronous fallback
  -> success response
```

授权失败必须先于 `getStorage`，从结构上保证拒绝路径不能留下对象、数据库行或处理任务。`getDb` 从存储写入之后前移到授权之前，因此数据库获取失败也不再需要存储补偿；文件插入仍位于存储写入之后并保留既有补偿。

## Test Design

1. 先扩展测试数据库 mock，使其分别暴露 `select/from/where/limit` 与 `insert/values`，并让查询默认返回当前用户会话。
2. 添加其他用户/不存在会话 tracer bullet：查询返回空数组，断言 403、统一文案以及 storage、insert、queue、process 均未调用。修复前该用例会成功上传。
3. 断言 `and(eq(conversations.id, conversationId), eq(conversations.userId, user.id))` 的组合条件，防止未来退化为只校验存在性。
4. 添加空 ID 用例，断言不调用 select、落库为 `null`。
5. 调整 DB 获取失败用例：新顺序下应断言 storage 未触达；继续保留 DB 插入失败时的对象补偿测试。
6. 运行现有整份上传路由测试，确认大小限制、清洗、队列和 fallback 行为不变。

测试调用公开 `POST` handler，只 mock session、multipart、数据库、存储、队列和处理器边界，不导出内部授权函数。

## Trade-Offs

- 选择组合查询而非“按 ID 查询后比较 `userId`”，因为前者不会把其他用户的会话行带回应用层，权限条件也能由测试直接约束。
- 不使用 `withConversationMessageWrite`：上传只需要授权读取，不写会话消息，也不需要额外事务或行锁。
- 不新增共享 helper：当前只有上传路由缺少该校验，抽象不会减少真实重复，反而扩大变更面。
- 不用 schema 迁移解决属主一致性：跨表复合约束需要同步调整键结构和历史数据，超出本轮最小修复范围；请求入口校验能直接阻断已知路径。

## Compatibility And Rollback

- 合法会话与无会话上传的响应格式保持不变；唯一对外变化是非法关联从成功变为 403。
- 无 schema、数据或协议迁移。回滚路由、测试和规范提交即可恢复旧行为，但会重新暴露跨用户关系污染。
- 若组合查询暴露 ORM 类型问题，优先沿用项目现有 `drizzle-orm` 的 `and`/`eq` 用法，不退回只按 ID 查询的弱校验。
