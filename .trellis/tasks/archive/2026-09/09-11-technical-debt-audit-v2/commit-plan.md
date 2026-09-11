# 已确认提交计划

用户已确认以下四个工作提交及后续归档、日志记录；不会推送。未识别的脏文件：无。

## 1. fix: cover all PostgreSQL suites in test entrypoint

- package.json
- scripts/postgres-tests.test.mjs
- apps/web/scripts/test-file-processing-lease-pg.ts
- apps/worker/scripts/test-queue-lifecycle-pg.ts
- .trellis/spec/backend/ci-container-publishing.md
- .trellis/tasks/09-11-pg-test-coverage/（任务及验证记录）

## 2. fix: validate chat image and MCP request boundaries

- packages/core/src/http/api/chat.ts
- packages/core/src/http/api/image-generate.ts
- packages/core/src/http/api/image-generate.test.ts
- packages/core/src/http/v1/mcp.ts
- packages/core/src/http/v1/mcp.test.ts
- apps/web/src/app/api/chat/route.test.ts
- .trellis/spec/backend/error-handling.md
- .trellis/tasks/09-11-http-input-boundaries/（任务及验证记录）

## 3. refactor: preserve route repository query types

- packages/core/src/lib/repositories/route-repository.ts
- packages/core/src/lib/routing.ts
- packages/core/src/lib/routing.test.ts
- packages/core/src/lib/providers/multimodal/image-gen.test.ts
- packages/core/src/lib/stream-agent-loop.test.ts
- packages/core/src/lib/stream-circuit-breaker.test.ts
- .trellis/tasks/09-11-route-repository-types/（任务及验证记录）

## 4. refactor: type chat read models and share option mapping

- apps/web/src/app/chat/page.tsx
- apps/web/src/app/chat/[id]/page.tsx
- apps/web/src/features/chat/actions/share.ts
- apps/web/src/features/chat/lib/visible-branch.ts
- apps/web/src/features/chat/model/composerOptions.ts
- apps/web/src/features/chat/model/composerOptions.test.ts
- apps/web/src/lib/output-modes/service.ts
- apps/web/src/lib/render-styles/service.ts
- .trellis/tasks/09-11-chat-read-model-types/（任务及验证记录）
- .trellis/tasks/09-11-technical-debt-audit-v2/（审计、跨批验收与本计划）
