# Implementation Plan

1. 扩展 `src/app/api/upload/route.test.ts` 的 Drizzle mock，增加默认成功的会话属主查询链，保持既有合法上传测试语义。
2. 先添加 foreign/missing 会话回归测试，断言 403、统一文案、组合查询包含会话 ID 与用户 ID，以及 storage、文件 insert、队列和同步处理均未调用；运行聚焦测试并确认修复前失败。
3. 添加空 `conversationId` 用例，断言跳过会话查询、上传成功并写入 `null`；补强合法会话用例的组合条件断言。
4. 在上传路由导入 `and`/`eq`，把数据库与 schema 获取前移到存储之前；非空会话执行组合属主查询，空结果直接返回 403，后续插入复用同一数据库实例。
5. 调整数据库获取失败测试以匹配新的副作用顺序；保留并验证数据库插入失败后的存储补偿、补偿失败日志和原始异常传播。
6. 更新 `.trellis/spec/backend/file-storage.md`，补充客户端会话关联的授权边界、执行顺序、正确/错误示例、测试矩阵和审查清单。
7. 执行 break-loop 根因分析并写入本轮 research，确认该类资源关联接口以后必须同时校验资源 ID 与 owner，且拒绝发生在外部副作用之前。
8. 使用两路只读子代理分别复核实现/权限边界与测试防回归能力，主代理按精确 `file:line` 点验发现并修正阻塞项。
9. 运行聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 和 `task.py validate`，检查范围与敏感产物；提交工作、归档任务、记录 journal，并立即创建第 17 轮。

## Validation Commands

- `pnpm exec vitest run src/app/api/upload/route.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-16`

## Risk And Rollback Points

- 权限条件必须同时包含 `conversations.id` 与 `conversations.userId`；只查 ID 再遗漏 owner 比较会保留原漏洞。
- 拒绝分支必须位于 `getStorage` 和 `storage.put` 之前；若先写存储再拒绝，会重新引入补偿与残留风险。
- DB 获取失败不再触发存储补偿，因为新顺序下尚未写入对象；文件 insert 失败仍必须补偿删除。
- 空字符串必须跳过查询并写 `null`，不能误判为 403，否则会破坏未关联上传。
- foreign 与 missing 必须同文案同状态，不能通过响应区分目标会话是否存在。
- 若实现需要 schema 迁移、历史数据清理或共享授权层，应返回规划并拆分任务，不在本轮扩大范围。

## Completion Gate

- 非空关联只允许当前用户会话，foreign/missing 均在任何后续副作用前返回统一 403。
- 空关联与合法关联的既有上传行为保持不变。
- DB 获取失败和 DB 插入失败分别符合新执行顺序与既有补偿契约。
- 文件存储规范覆盖该类授权边界，独立复核无阻塞项，全部自动化门禁通过。
