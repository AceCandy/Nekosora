# 提交计划（用户已确认，不推送）

1. fix(chat): 明确加载失败并提供重试
   - apps/web/messages/en.json
   - apps/web/messages/zh-CN.json
   - apps/web/src/app/chat/[id]/page.tsx
   - apps/web/src/app/chat/[id]/page.test.tsx
   - apps/web/src/app/chat/page.tsx
   - apps/web/src/app/chat/layout.tsx
   - apps/web/src/app/chat/error.tsx
   - apps/web/src/app/chat/error.test.tsx
   - apps/web/src/features/chat/actions/conversations.ts
   - apps/web/src/features/chat/actions/conversations.test.ts
   - apps/web/src/features/chat/lib/load-data.ts
   - apps/web/src/features/chat/lib/load-data.test.ts
   - .trellis/spec/backend/error-handling.md
   - .trellis/tasks/09-11-chat-load-failures/（全部任务文件）
2. refactor(core): 恢复生成任务生命周期类型约束
   - packages/core/src/lib/chat/run-lifecycle.ts
   - .trellis/tasks/09-11-run-lifecycle-types/（全部任务文件）
3. refactor(core): 恢复用量查询与结果类型
   - packages/core/src/lib/usage-aggregate.ts
   - packages/core/src/lib/usage-aggregate.test.ts
   - .trellis/tasks/09-11-usage-query-types/（全部任务文件）
   - .trellis/tasks/09-11-technical-debt-convergence-v3/（全部任务文件，包含本计划）

无未识别的脏文件。每批可独立回滚；产品提交全部完成后再按流程处理归档与日志。
验收缺口见 check.md；提交不代表真实浏览器和 PostgreSQL 验收已通过。
