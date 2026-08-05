# Fastify 完整数据面迁移

## Goal

Implement an independently runnable Fastify data-plane service and move the complete model/chat/file/image/knowledge HTTP surface to it while preserving existing public contracts.

## Requirements

- Create `apps/gateway` with Fastify 5.11.2 and framework-neutral shared packages containing actual extracted code.
- Migrate all parent-design Gateway-owned routes, including API-key and session authentication.
- Preserve OpenAI JSON/SSE, WebChat SSE, multipart/binary responses, cancellation, error localization, logging and persistence semantics.
- Keep same-origin public URLs. During this child, Next may proxy selected routes to the verified Gateway as a reversible transition.
- Remove direct data-plane execution and queue/storage imports from Web after proxy cutover.

## Acceptance Criteria

- [ ] All migrated finite routes pass Fastify injection contract tests.
- [ ] Chat and WebChat streams preserve byte-level frame/terminal/header behavior and disconnect cancellation.
- [ ] Better Auth cookies authorize session routes; spoofed identity headers do not.
- [ ] Upload, local/S3 file access, image and knowledge flows preserve authorization and storage behavior.
- [ ] Gateway can run while Web is stopped for API-key `/v1/*` traffic.
- [ ] Web's selected paths proxy to Gateway without changing browser URLs.
- [ ] Explicit route matrix passes: `/v1/models` JSON/API-key; `/v1/chat/completions` finite+SSE/API-key; `/v1/images/generations` JSON; `/v1/audio/speech` binary; `/v1/audio/transcriptions` multipart; `/v1/mcp` GET+JSON-RPC; `/api/chat` SSE/session; `/api/upload` multipart/session; `/api/files/:fileId` 200/206/302/416/session; `/api/images` GET/session; `/api/images/generate` POST/session; `/api/knowledge/search` POST/session; `/metrics` text/edge restriction.
- [ ] The previous Web data-plane image and route configuration remain deployable, and a rollback smoke restores old handlers before this child is accepted.

## Out of Scope

- Production edge-router cutover and final proxy removal.
- Replacing Better Auth, Drizzle, pg-boss or provider SDKs.
