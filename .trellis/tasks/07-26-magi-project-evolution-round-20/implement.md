# 实施计划

## 1. 建立失败先行测试

- 扩展 `src/lib/rag/process.test.ts`：覆盖 pending/error claim、有效租约拒绝、过期/NULL 租约接管、数据库时间谓词与旧 token 无法进入 chunk 事务。
- 在 extract 完成写、embedding running/done/error、unsupported、empty、普通 catch 和最终 chunk 事务前分别模拟 lease 丢失，断言后续状态/chunk 写均停止且不覆盖新 owner。
- 覆盖 heartbeat 单飞、失败标记失租约、停止清 timer/等待 in-flight；覆盖 chunk delete、分批 insert 与 `done` 同事务，最终写使用 `statement_timestamp()` 复验 freshness，插入失败或最终租约过期时事务回滚且不提交终态。
- 新增恢复调度与 worker 测试：启动立即扫描、周期单飞、`unref()`、查询失败可重试、单候选失败继续、25 条背压、停止等待、信号关闭顺序与重复信号单飞。
- 新增迁移一致性测试：回填只匹配 `extracting/embedding AND lease IS NULL` 并使用 `now()`；snapshot 精确断言两列 nullable `timestamptz`、部分索引谓词；journal 精确断言 idx/tag/when 与 snapshot `prevId` 连续。
- 新增仅接受内部 `TEST_DATABASE_URL` 的 PostgreSQL 集成测试，并新增 `scripts/test-file-processing-lease-pg.ts` 安全 harness：随机临时库、完整迁移、并发 claim、旧 token fencing、父行锁等待/谓词重判、最终 freshness 与 chunk 事务回滚、`finally` 强制清理。

验证：新测试在实现前因缺少 schema/行为失败，且失败原因与 PRD 一致。

## 2. 追加 PostgreSQL schema 与迁移

- 在 `fileObjects` 增加 `processingLeaseId`、`processingLeaseExpiresAt` 和 `(leaseExpiresAt, createdAt)` stale 扫描部分索引（含 NULL active 行）。
- 通过现有 Drizzle 生成流程追加 `0013` SQL、journal 和 snapshot；只对新迁移补充活动记录回填 SQL，不改写 `0000`-`0012`。
- 运行迁移一致性测试和 schema 相关测试。

回滚点：只有 schema/迁移与测试改动；迁移未执行时可直接恢复工作树，迁移已执行时保留兼容的 nullable 字段。

## 3. 实现租约 claim、续租与 fenced 写入

- 在 `src/lib/rag/process.ts` 建立数据库时间租约常量和内部 lease-lost 错误。
- 扩展 claim 谓词支持 stale 活动状态，并返回/持有新 token。
- 把所有文件状态更新收敛为 owned 条件写；租约丢失后禁止继续持久化。
- 增加单飞 heartbeat，并在所有退出路径停止、等待。
- 把 chunk 删除、批量插入、最终状态更新放进同一事务，事务首步验证/续租 token。
- 保留现有 unsupported、empty、embedding unavailable/error 与普通异常语义。

验证：运行 `src/lib/rag/process.test.ts`，并检查 upload 与 queue 回归测试。

## 4. 实现 stale 扫描和 worker 生命周期

- 导出有上限、稳定排序、可重复调用的 stale 扫描函数；SELECT 失败向调度器传播，单候选失败记录脱敏错误后继续，候选仍由 `processFile` 原子 claim。
- 新增最小调度模块，负责启动立即扫描、周期单飞、timer `unref()`、失败后保留下轮调度与异步停止。
- 修改 `src/worker.ts`：导出可测试的 `startWorker`，handler 注册后启动调度；重复关闭复用 Promise；先停扫描再停 queue，最后调用注入的 runtime exit。

验证：运行恢复调度与 worker 测试，断言信号回调和关闭顺序，不以人工检查代替可执行验收。

## 5. 独立复核与完整门禁

- 两名只读探子分别复核：租约/事务竞态；迁移/worker 生命周期/测试缺口。
- 主代理按 `file:line` 点验并修复确认的问题。
- 更新 `.trellis/spec/backend/file-storage.md`，记录 stale 恢复、fencing、事务和 worker 生命周期契约。

验证命令：

```bash
pnpm vitest run src/lib/rag/process.test.ts src/lib/rag/recovery.test.ts src/lib/rag/file-processing-lease-migration.test.ts src/app/api/upload/route.test.ts src/lib/infra/queue.test.ts
pnpm vitest run src/worker.test.ts
pnpm exec tsx --env-file-if-exists=.env.local scripts/test-file-processing-lease-pg.ts
pnpm check
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-20
git diff --check
```

本轮不启动新服务。真实 PG harness 自行构造随机临时库并在 `finally` 关闭连接、强制删除；现有业务数据库只作为管理连接，不承载测试表或测试数据。若临时库验证未通过或未清理，本轮不得完成。
