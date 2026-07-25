# Implementation Plan

1. 读取分享消息引用、类型安全和跨层规范。
2. 先补物理缺失快照仍可读的失败测试，确认当前实现会丢失 assistant 正文。
3. 最小修改 `getShare` 查询和三态过滤，使物理缺失、软删除、实时存在三类行为分别成立。
4. 强化历史 null 快照测试，覆盖物理缺失和软删除均不返回，并断言查询限定会话与 ID 集合。
5. 独立复核编辑流程真实硬删除路径、软删除隐私契约、历史兼容和测试变异有效性。
6. 更新消息引用规范，记录“缺失不等于软删除”的分享读取契约。
7. 运行定向测试、lint、typecheck、全量测试、生产构建和 diff 检查。
8. 分别提交实现、归档任务和 journal。

## Risk And Rollback Points

- `src/features/chat/actions/share.ts`：不得把缺失消息展示到历史动态分享，也不得把软删除快照重新公开。
- `src/features/chat/actions/share.test.ts`：mock 行必须显式带 `deletedAt`，避免继续依赖“查询返回集已过滤”的假设。
- 无 schema 变更，业务提交可独立回滚。

## Completion Gate

- 三态矩阵均有可区分的回归断言。
- 独立复核无阻断问题。
- 全量质量门禁通过且工作树无临时产物。
