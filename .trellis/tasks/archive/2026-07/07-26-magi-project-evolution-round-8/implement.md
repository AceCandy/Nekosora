# Implementation Plan

1. 先补“完整前缀 + 相同 hash 旧时间戳”的失败测试。
2. 实现纯内存协调计划与条件账本 UPDATE，使测试转绿。
3. 增加前序缺失、后续提前、未知记录和正常账本测试。
4. 独立复核算法不会跳过未执行迁移，并审查 SQL 构造与并发条件。
5. 更新数据库迁移规范，运行定向和全量质量门禁。
6. 临时启动应用验证真实账本修复与 `0010` 应用，验证后关闭服务。
7. 分别提交实现、归档任务和 journal，然后继续下一轮。

## Risk And Rollback Points

- `src/lib/infra/db/bootstrap.ts`：任何歧义必须 fail-closed，不得把 schema 存在当作迁移完成证据。
- `src/lib/infra/db/bootstrap.test.ts`：测试必须证明错误路径没有 UPDATE、没有调用 migrate。
- 真实 DB 验证前保留完整只读账本证据；只允许更新迁移记录时间并由正式迁移新增 `0010` 列。

## Completion Gate

- 安全协调、拒绝矩阵和正常路径均有自动化测试。
- 独立复核无阻断问题。
- 应用真实启动成功且调试服务已关闭。
