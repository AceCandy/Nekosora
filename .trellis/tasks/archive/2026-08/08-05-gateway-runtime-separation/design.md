# Design: Gateway Runtime Separation

## Target Topology

```text
Client
  -> edge router (same public origin)
       -> /v1/* and selected /api/* -> apps/gateway :4000
       -> all other paths          -> apps/web :3000

apps/gateway -> PostgreSQL / Redis / object storage / pg-boss producer
apps/web     -> PostgreSQL / Redis for control-plane SSR and Server Actions
apps/worker  -> PostgreSQL / object storage / pg-boss consumer
```

Production routing is owned by an independent edge router, not Next rewrites. During migration and local development, Next may temporarily proxy the selected paths to Gateway so the public origin and session cookie remain unchanged.

## Workspace Boundaries

- `apps/web`: Next.js 16.3.0 App Router, React 19, UI, Better Auth HTTP route, control-plane pages and Server Actions.
- `apps/gateway`: Fastify 5.11.2 HTTP process, all public/model data-plane routes, session/API-key adapters, SSE, data-plane health and metrics.
- `apps/worker`: Node.js process owning pg-boss work registration, recovery and shutdown.
- `packages/contracts`: framework-neutral request/result/error/SSE contracts and Zod boundary schemas.
- `packages/db`: Drizzle schema, migrations-facing types and process-local PostgreSQL pool factory.
- `packages/core`: provider IR, routing, gateway execution, chat orchestration services and other framework-neutral domain logic.
- `packages/observability`: usage/error classification, metrics definitions and safe logging helpers.
- `packages/queue`: typed catalog plus pg-boss adapter shared by Gateway producers and Worker consumers. Web must not depend on this package.

Packages export explicit subpaths. No shared package accepts `NextRequest`/`FastifyRequest` or returns `NextResponse`/`FastifyReply`.

## HTTP Ownership

Gateway owns `/v1/models`, `/v1/chat/completions`, `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/mcp`, `/api/chat`, `/api/upload`, `/api/files/:fileId`, `/api/images`, `/api/images/generate`, `/api/knowledge/search`, and `/metrics`. The edge router preserves `/metrics` for compatibility but production configuration restricts scraper access.

Web owns `/api/auth/*`, pages, static assets, Next internals, share pages, admin/panel actions, and Web health endpoints. Internal Gateway and Worker health ports are not exposed as public product APIs.

## Authentication

- `/v1/*` preserves `Authorization: Bearer sk-*` and the existing `verifyKey` semantics.
- Session-authenticated data routes pass the original cookie/header set into Better Auth through `auth.api.getSession({ headers })`; Gateway never accepts a caller-supplied user-id header.
- The edge router preserves `Host`, `Origin`, cookies and forwarding headers. Production trusted origins remain derived from the public application URL.
- Resource authorization remains inside existing domain services before DB, secret, network, cache or breaker side effects.

## Streaming

Fastify JSON routes use ordinary reply serialization. SSE routes call `reply.hijack()` and own `reply.raw` until completion. They preserve existing frame bytes, headers, `[DONE]` rules and terminal-event order. Raw request close/abort feeds the existing `AbortController`; abort does not retry, fail over or record provider failure.

Protocol tests use Fastify `inject()` for finite responses and an ephemeral real listener for disconnect/cancellation behavior.

## Queue And Storage

Gateway creates durable outbox rows in the existing transaction and dispatches pg-boss after commit using the existing claim/recovery rules. Worker consumes the same typed definitions. Static or literal imports replace variable-path package imports because neither package is in the Next graph.

Local storage uses one named volume mounted into Gateway and Worker. Web no longer reads or writes uploaded files directly. S3-compatible storage behavior remains unchanged.

## Health And Capacity

- Web liveness/readiness covers its own process and required control-plane DB dependency; it no longer checks pg-boss.
- Gateway liveness/readiness covers DB, queue producer and configured storage.
- Worker exposes a minimal native-HTTP health endpoint backed by runtime state; readiness becomes false during startup/shutdown.
- Each process owns a separate DB pool. Defaults and deployment docs allocate an explicit total connection budget rather than multiplying the old per-process maximum unnoticed.

Readiness failure matrix: Web is unready on required DB failure; Gateway is unready on DB, queue-producer or configured-storage failure; Worker is unready before registration, during shutdown, or after queue/runtime failure. Liveness remains 200 while the corresponding process event loop can serve requests.

## Rollout And Rollback

1. Establish workspace and Next 16 without changing endpoint ownership.
2. Start Gateway beside Next and run contract tests against both.
3. Switch Next selected routes to a temporary Gateway proxy; revert the proxy to restore old handlers if needed.
4. Start the independent Worker and prove queue drain/recovery.
5. Put the edge router in front and route data paths directly to Gateway.
6. Remove temporary Next proxies and obsolete dynamic-import workarounds only after direct-path smoke tests and a rollback drill using the retained previous Web image and edge configuration.

Database schema remains compatible, so rollback is deployment/config based and does not require data reversal. The previous Web image, lockfile and edge route configuration remain deployable until the final cutover observation window passes.

## Task Map

1. `08-05-workspace-next16`
2. `08-05-fastify-data-plane` (depends on 1)
3. `08-05-worker-queue-boundary` (depends on 2 shared packages)
4. `08-05-runtime-cutover` (depends on 1-3)
