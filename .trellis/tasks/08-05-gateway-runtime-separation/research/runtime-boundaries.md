# Runtime Boundary Research

## Confirmed Current Boundaries

- `package.json:10-12,58` uses bare `next dev/build/start` with Next.js 15.5.21. The current development output is Webpack-backed.
- `src/app/v1/chat/completions/route.ts:30` and the other `/v1/*` handlers primarily adapt `NextRequest`/`NextResponse` to framework-independent services. `src/lib/stream.ts`, `src/lib/routing.ts`, provider registries, key verification, usage logging, and gateway execution do not import Next.js.
- `src/app/api/chat/route.ts:66` is more coupled: session resolution uses `next/headers`, error construction uses `NextResponse`, and `src/lib/chat/orchestrator.ts` returns `NextResponse` errors. These response concerns must be converted to framework-neutral result values before the route moves.
- Better Auth 1.6.23 exposes `auth.api.getSession({ headers: Headers })`, so Fastify can validate the existing same-origin session cookie without trusting a user-supplied identity header.
- Current direct queue consumers are the conversation-title dispatcher, memory dispatcher, upload route, readiness route, and worker. Moving only chat and `/v1/*` would leave the upload and readiness paths coupled to `pg-boss` in the Next dependency graph.
- The current Docker image starts only one Next standalone process. Compose starts PostgreSQL and Redis but has no application, worker, or path-routing service.

## Third-Party Findings

- npm stable versions observed on 2026-08-05: Next.js 16.3.0 and Fastify 5.11.2. Production dependencies must be pinned to reviewed stable versions, not canary or floating `latest` ranges.
- Current Next.js official documentation makes Turbopack the default for both development and production builds; Webpack remains an explicit `--webpack` fallback.
- Fastify v5 supports taking ownership of SSE through `reply.hijack()`/`reply.raw`; once hijacked, the application owns response completion and timeout handling. Client cancellation must be wired from the raw request close/abort lifecycle into the existing `AbortController`.
- Fastify's built-in `inject()` boots plugins and exercises HTTP adapters without opening a port, which fits the existing route-level protocol tests.
- `serverExternalPackages` is the supported Next.js escape hatch for packages that genuinely remain in Server Components or Route Handlers, but the preferred boundary is to keep Gateway/Worker-only drivers outside the Web dependency graph entirely.

## Recommended Runtime Split

- Edge ingress: `/v1/*` and selected chat data-plane `/api/*` paths to Gateway; all UI, auth, admin, panel, sharing, static and Next internal paths to Web.
- Web: Next.js UI/control plane and Better Auth endpoints; it must not proxy Gateway traffic in production.
- Gateway: public model API, WebChat generation/data endpoints, explicit request/session adapters, streaming and data-plane health/metrics.
- Worker: pg-boss consumer/recovery process.
- Shared packages remain framework-neutral. No shared package may return `NextResponse` or accept `FastifyRequest`.

## Blocking Scope Decision

The minimum previously named move (`/v1/*` plus `/api/chat`) does not fully remove queue/storage dependencies from Web because `/api/upload` still calls `getQueue()`. The clean boundary is to move the chat data-plane endpoint family together: chat generation, upload/file delivery, image generation/listing, and knowledge search. Better Auth and control-plane CRUD stay in Next.
