# Implementation Plan

1. 阅读数据库、后端分享与跨层类型规范，确认现有测试和迁移生成方式。
2. 先补分享 action 回归测试：新分享写入有序快照、编辑/续写后正文冻结、软删除过滤、历史 null 快照动态回退。
3. 在 PostgreSQL schema 增加 nullable `messageSnapshotsJson`，并最小修改分享创建与读取逻辑使测试通过。
4. 新增 `0010` PostgreSQL 迁移，同步 Drizzle journal 和 snapshot，检查 schema 差异仅包含目标列。
5. 独立复核跨层语义、迁移一致性、历史兼容与软删除隐私契约，修正发现的问题。
6. 更新分享消息引用规范，记录正文快照与旧记录兼容约束。
7. 运行定向测试、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`。
8. 分别提交实现、归档任务和开发日志。

## Risky Files And Rollback Points

- `src/features/chat/actions/share.ts`：创建与读取双路径必须保持顺序、权限和软删除过滤。
- `src/db/schema/pg.ts` 与 `drizzle/pg/meta/0010_snapshot.json`：必须与 SQL 迁移完全一致。
- 若正文快照路径出现兼容问题，可回退应用读取分支；nullable 列不会阻断旧版本。

## Completion Gate

- 所有验收场景均有自动化测试或明确的静态验证证据。
- 独立复核无阻断问题。
- 全量质量命令通过，工作树不包含临时文件或敏感产物。
