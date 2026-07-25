# MAGI 项目进化第 8 轮

## Goal

修复 Drizzle 同一迁移 SQL 因 journal 时间戳改写而被重复执行、阻断应用启动的问题，并防止协调逻辑掩盖真正的迁移断层。

## Background

- 当前数据库已存在 `message_feedback`，且其迁移 hash `e4d04b5e...` 以旧时间戳 `1784960819328` 登记。
- 当前 journal 将同一 hash 对应的 `0009_lethal_killmonger` 标为 `1784988074784`。
- Drizzle PG migrator 只比较账本最新 `created_at` 与 journal `when`，不按 hash 判断是否已执行，因此重复运行 `CREATE TABLE message_feedback`。
- `0010_lazy_gorgon` 尚未执行，`conversation_shares.message_snapshots_json` 当前不存在。

## Requirements

- 启动迁移前识别“当前迁移 hash 已登记但 created_at 与 journal 不同”的安全可协调场景。
- 只有所有前序 journal 时间戳已连续登记、目标时间未占用、没有后续迁移提前登记、没有未知额外账本记录时，才修正该 hash 行的 `created_at`。
- 不通过 schema 猜测迁移已执行，不修改 hash，不重跑已确认的相同 SQL。
- 新数据库、正常升级数据库和完整基线收养流程保持现有行为。
- 前序缺失、重复 hash/时间戳、目标冲突、未知记录或非单调 journal 必须阻断启动并给出明确错误。
- 协调后仍由官方 Drizzle migrator 执行真正未应用的尾部迁移。

## Acceptance Criteria

- [x] 相同 hash 以旧时间戳登记且前序完整时，只修正账本时间并继续迁移。
- [x] 前序迁移缺失或后续迁移提前登记时，不修改账本且不调用 migrator。
- [x] 正常账本与空账本不产生协调 UPDATE。
- [x] 当前开发数据库启动成功，`0010` 被应用且分享快照列存在。
- [x] lint、typecheck、全量测试和生产构建通过。

## Out Of Scope

- 自动修复 SQL hash 不匹配或未知 schema 漂移。
- 修改已发布迁移 SQL、删除业务表或重建数据库。
- 绕过迁移的 `BOOTSTRAP_SKIP_MIGRATE` 配置。
