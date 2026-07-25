# Implementation Plan

1. 先扩展 helper 测试，断言 public/internal ID 查询都包含 `isNull(deletedAt)`，确认失败。
2. 修改 helper 导入和查询条件使测试转绿。
3. 补 `getMessageSiblings` 墓碑目标提前返回测试，并修改初始查询。
4. 独立复核全部 helper 调用方、错误语义与查询次数。
5. 更新消息引用规范，运行定向与全量质量门禁。
6. 分别提交实现、归档任务和 journal。

## Completion Gate

- helper 与直接 siblings 查询均有回归断言。
- 独立复核无阻断问题。
- lint、typecheck、全量测试、构建和 diff 检查通过。
