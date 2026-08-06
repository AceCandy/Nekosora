# Design

- Build `apps/gateway` with a `buildServer()` factory for injection tests and a thin process entry for listen/shutdown.
- Extract only genuinely shared modules into `packages/contracts`, `packages/db`, `packages/core`, `packages/observability` and `packages/queue`; use explicit package subpath exports to prevent Web from importing queue/data-plane code accidentally.
- Convert `NextResponse`-returning error/orchestrator paths to framework-neutral result objects. Next and Fastify adapters serialize the same contract.
- Authenticate WebChat routes by passing Fastify request headers into the existing Better Auth instance. API-key routes reuse `verifyKey`.
- Use `@fastify/multipart` for bounded multipart parsing. Preserve current size/type/ownership validation order.
- Return Web `Response` bodies through Fastify's Node stream adapter for SSE and binary streaming. Propagate raw request close to AbortController and finalize iterators/telemetry on every terminal path.
- Register liveness/readiness separately from the shared business route matrix. Close DB/queue resources on shutdown.
- After parity passes, replace selected Next handlers with a development/transitional proxy to `GATEWAY_INTERNAL_URL`; production direct routing is deferred.

Rollback in this child: remove `GATEWAY_INTERNAL_URL` so Next executes the retained thin Web handlers, then stop Gateway. The smoke must load a real Web handler and prove that the request no longer reaches Gateway. Retained production images and edge configuration are owned by `08-05-runtime-cutover`. Shared domain functions retain existing signatures/data contracts, so no data rollback is required.
