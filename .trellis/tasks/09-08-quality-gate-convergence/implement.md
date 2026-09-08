# 执行计划

- [x] 启用 Core/Web/Queue 测试类型检查并记录完整诊断。
- [x] 逐文件修复测试类型问题与协议测试警告，不变更测试所验证的行为。
- [x] 各现有 lint 脚本启用零警告门禁。
- [x] 同步目录与质量规范。
- [x] 核对每个包现有 TS/TSX 测试均在 tsc 文件集合内。
- [x] 运行 `pnpm check`、`pnpm test` 和 `git diff --check`。
- [x] 独立复核完整 diff；记录测试数量、未验证项和剩余风险。

真实 PostgreSQL 测试通过既有显式入口独立运行，本批没有改数据库行为；浏览器和制品发布不作为静态门禁修复的已验证结果。需要合并发布时仍执行项目原有构建、容器和 PG 门禁。

## 验证结果（2026-09-08）

- `pnpm check`：8 个工作区覆盖检查、5 个零警告 lint、8 个 typecheck 均通过；最终精简测试 helper 后再次通过。
- `pnpm test`：1,837 通过、42 跳过，与修改前基线一致；无新增跳过或删除测试。
- 最终 helper 精简后，`pnpm --filter @nekusora/core exec vitest run src/lib/gateway-execution/engine.test.ts` 再次通过 28 项。
- 用 TypeScript `readConfigFile` / `parseJsonConfigFileContent` 核对磁盘测试文件与编译文件集合：Core 120/120、Queue 2/2、Gateway 2/2、Worker 2/2、Web 83/83，共 209 个文件全部覆盖；其余三个包暂无独立测试。
- 只读子代理复核测试 diff，主线程复核配置、目录事实、关键断言与全部变更范围，未发现阻断项；复查移除了本次引入但未使用的 deferred reject 出口。
- `git diff --check` 通过。未改依赖、锁文件、数据库或生产逻辑；唯一生产源码变更是删除未使用的类型 import。
- 没有启动调试服务，没有产生需保留的隐私文件或临时导出；类型检查仅更新既有忽略缓存。

## 未验证与剩余范围

- 未运行真实 PostgreSQL、浏览器、生产构建、Docker 或远程 CI；42 个 PG 用例仍需既有显式集成入口验证。
- 本批降低检查盲区，不代表技术债全清；数据库类型、跨包源码别名/导出边界、聊天重复 SSE 流程仍属于后续批次。
- 尚未提交或推送；依收尾流程暂不归档，任务保留 `in_progress`，等待一次性提交计划确认。

## 待确认的提交计划

单次提交：`chore: enforce typed tests and zero-warning lint`。
门禁配置、配套测试修复和规范属于同一可回滚单元；任务资料随本批记录。
未识别的脏文件：无。用户确认前不执行提交，不推送。

文件清单（相对仓库根目录）：

- `.trellis/spec/backend/ci-container-publishing.md`
- `.trellis/spec/backend/directory-structure.md`
- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `apps/gateway/package.json`
- `apps/web/package.json`
- `apps/web/src/app/(dash)/admin/actions.test.ts`
- `apps/web/src/app/(dash)/panel/actions.test.ts`
- `apps/web/src/app/v1/audio/speech/route.test.ts`
- `apps/web/src/app/v1/audio/transcriptions/route.test.ts`
- `apps/web/src/app/v1/images/generations/route.test.ts`
- `apps/web/src/db/schema/pg.test.ts`
- `apps/web/src/features/README.md`
- `apps/web/src/features/chat/actions/feedback.test.ts`
- `apps/web/src/features/chat/lib/share-rate-limit.test.ts`
- `apps/web/src/features/chat/model/sse.test.ts`
- `apps/web/src/lib/sync-pi-models-cli.test.ts`
- `apps/web/src/shared/README.md`
- `apps/web/tsconfig.json`
- `apps/worker/package.json`
- `packages/core/package.json`
- `packages/core/src/lib/chat/process-trace.test.ts`
- `packages/core/src/lib/compact/service.test.ts`
- `packages/core/src/lib/conversation-title/service.test.ts`
- `packages/core/src/lib/gateway-execution/engine.test.ts`
- `packages/core/src/lib/gateway-execution/telemetry.test.ts`
- `packages/core/src/lib/infra/db/bootstrap.test.ts`
- `packages/core/src/lib/protocols/encoders.test.ts`
- `packages/core/src/lib/protocols/handler.test.ts`
- `packages/core/src/lib/protocols/multi-protocol-matrix.test.ts`
- `packages/core/src/lib/protocols/parsers.ts`
- `packages/core/src/lib/providers/multimodal/audio-adapters.test.ts`
- `packages/core/src/lib/providers/probe.test.ts`
- `packages/core/src/lib/providers/timeouts.test.ts`
- `packages/core/src/lib/rag/process.pg.test.ts`
- `packages/core/src/lib/settings-control/changes.test.ts`
- `packages/core/src/lib/stream-agent-loop.test.ts`
- `packages/core/src/lib/stream-circuit-breaker.test.ts`
- `packages/core/src/lib/stream.test.ts`
- `packages/core/src/lib/trace.test.ts`
- `packages/core/src/lib/usage.test.ts`
- `packages/core/src/lib/web-search/service.test.ts`
- `packages/core/src/lib/worker/runtime.test.ts`
- `packages/core/tsconfig.json`
- `packages/queue/package.json`
- `packages/queue/src/index.test.ts`
- `packages/queue/tsconfig.json`
- `.trellis/tasks/09-08-quality-gate-convergence/check.jsonl`
- `.trellis/tasks/09-08-quality-gate-convergence/design.md`
- `.trellis/tasks/09-08-quality-gate-convergence/implement.jsonl`
- `.trellis/tasks/09-08-quality-gate-convergence/implement.md`
- `.trellis/tasks/09-08-quality-gate-convergence/prd.md`
- `.trellis/tasks/09-08-quality-gate-convergence/task.json`
- `.trellis/tasks/09-08-technical-debt-convergence/check.jsonl`
- `.trellis/tasks/09-08-technical-debt-convergence/implement.jsonl`
- `.trellis/tasks/09-08-technical-debt-convergence/prd.md`
- `.trellis/tasks/09-08-technical-debt-convergence/task.json`
