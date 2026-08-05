# Design

- Build `apps/gateway` with a `buildServer()` factory for injection tests and a thin process entry for listen/shutdown.
- Extract only genuinely shared modules into `packages/contracts`, `packages/db`, `packages/core`, `packages/observability` and `packages/queue`; use explicit package subpath exports to prevent Web from importing queue/data-plane code accidentally.
- Convert `NextResponse`-returning error/orchestrator paths to framework-neutral result objects. Next and Fastify adapters serialize the same contract.
- Authenticate WebChat routes by passing Fastify request headers into the existing Better Auth instance. API-key routes reuse `verifyKey`.
- Use `@fastify/multipart` for bounded multipart parsing. Preserve current size/type/ownership validation order.
- Use `reply.hijack()` for SSE and binary streaming. Propagate raw request close to AbortController and finalize iterators/telemetry on every terminal path.
- Register health/ready/metrics separately from public business plugins. Close DB/cache/queue resources on shutdown.
- After parity passes, replace selected Next handlers with a development/transitional proxy to `GATEWAY_INTERNAL_URL`; production direct routing is deferred.

Rollback: redeploy the retained pre-proxy Web image/configuration and stop Gateway. Keep that artifact until the final cutover observation window passes. Shared domain functions retain existing signatures/data contracts, so no data rollback is required.
