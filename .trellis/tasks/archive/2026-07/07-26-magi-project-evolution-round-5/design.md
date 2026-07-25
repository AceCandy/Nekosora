# Technical Design

## Boundary

改动限制在 PostgreSQL 分享表、分享创建/读取逻辑、对应测试和数据库迁移元数据。消息编辑、续写、删除流程与分享页面接口保持不变。

## Storage Contract

在 `conversation_shares` 增加 nullable JSONB 列 `message_snapshots_json`：

```ts
Array<{
  publicId: string;
  role: string;
  content: unknown;
}> | null
```

- 新分享写入非 null 快照。
- 历史分享保持 null，以明确表示沿用旧的动态读取语义。
- 不回填历史数据，避免把升级时正文误称为创建时正文。

## Create Flow

1. 客户端继续提交当前可见消息的 publicId 顺序。
2. 服务端沿用属主、会话、未删除、去重和全集匹配校验。
3. 服务端按客户端提交顺序重排已验证的数据库消息。
4. 同一次 insert 同时写入 `message_ids_json` 和对应的 `{ publicId, role, content }` 快照。

快照只使用服务端查询到的消息字段，不信任客户端正文或角色。

## Read Flow

1. `getShare` 继续按 `message_ids_json` 查询当前未软删除消息，用其 publicId 集合执行隐私过滤。
2. 当 `message_snapshots_json` 非 null 时，按快照原顺序返回仍存在于未删除集合中的快照项。
3. 当字段为 null 时，沿用现有动态读取：按 `message_ids_json` 顺序返回当前数据库正文。
4. 撤销状态和访问时间更新逻辑保持不变。

## Compatibility And Migration

- 迁移只新增 nullable JSONB 列，不设默认值、不回填、不改现有约束。
- 旧应用版本可忽略新列；新应用通过 null 分支兼容旧记录。
- 同步 `src/db/schema/pg.ts`、`drizzle/pg/0010_*.sql`、journal 与 `0010_snapshot.json`。

## Trade-offs

- 保留软删除过滤意味着分享不是不可撤销的法律归档，但符合既有隐私契约。
- 使用 JSONB 会复制正文数据，但范围仅限用户主动分享的消息，且避免引入新的版本表和跨表生命周期复杂度。
- 保留旧记录动态读取会形成明确的双语义分支，但比不可靠回填更诚实且风险更低。

## Rollback

应用代码可回退到忽略新列的旧读取逻辑；新增 nullable 列可暂时保留，不影响旧版本。若必须回滚迁移，可在确认没有新版本写入依赖后单独删除该列。
