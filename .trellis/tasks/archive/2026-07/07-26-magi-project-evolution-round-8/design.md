# Technical Design

## Boundary

`runMigrations` 从现有连接池取得一条专用连接，并以会话级 PostgreSQL advisory lock 串行化完整启动迁移。基线收养与账本协调在同一事务内完成，随后仍由官方 `migrate` 在同一连接上执行。迁移 SQL、journal、schema 和业务数据均不改。

## Inputs

- 当前 journal 通过 `readMigrationFiles` 提供有序 `{ hash, folderMillis }`。
- `drizzle.__drizzle_migrations` 提供全部 `{ id, hash, created_at }`。

## Validation And Planning

1. 校验 journal hash 合法且唯一、`folderMillis` 为严格递增整数。
2. 校验账本 id、hash、created_at 合法，id 与 created_at 不重复。
3. 已占用 canonical 时间戳的记录必须匹配当前 hash；只有 `0000` 已核实的原始发布 hash 可以通过显式白名单兼容，其他历史 hash 一律拒绝。
4. canonical 时间缺失但相同 hash 恰有一条旧记录时，只有全部前序 canonical 时间存在且无后续 canonical/hash 记录时，规划一次条件 UPDATE。
5. 首个真正未应用迁移之后不得存在任何已知后续或未知额外记录。
6. 先完成全部内存验证，再执行带目标时间空闲条件的 UPDATE；受影响行数不严格等于 1 时阻断并回滚协调事务。

除明确列入 `0000` 白名单的原始发布 hash 外，不允许 canonical 时间上的历史 hash 与当前文件不同。本轮不扩大为通用 hash 漂移修复。

## Concurrency And Connection Lifecycle

- advisory lock、协调事务和官方 migrator 共用同一条 `PoolClient`，避免 Pool 在内部事务中切换连接后丢失锁保护。
- 协调事务对 `drizzle.__drizzle_migrations` 取得 `SHARE ROW EXCLUSIVE` 表锁，防止校验与 UPDATE 之间出现账本写入。
- 官方 migrator 完成或抛错后都释放 advisory lock；无法确认释放时销毁连接，不把可能仍持锁的连接归还池。

## Data Flow

```text
acquire dedicated connection + advisory lock
→ transaction: ensure/lock ledger → baseline adoption → validate/plan reconciliation
→ conditional ledger timestamp update → commit
→ official Drizzle migrate on same connection → advisory unlock + release
```

## Rollback

代码可独立回退。账本 UPDATE 仅把已执行 SQL 的旧时间改为当前 journal 时间；原 id/hash 保留，可依据启动日志和数据库备份恢复旧时间。协调校验或 UPDATE 失败时事务整体回滚；进程退出也会由 PostgreSQL 释放会话锁。
