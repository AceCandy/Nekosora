# Gateway Runtime

> Fastify data-plane adapter, startup, readiness, proxy transition, and build contracts.

## Scenario: Independently Runnable Fastify Data Plane

### 1. Scope / Trigger

Apply this contract when changing `apps/gateway`, `packages/core/src/http`,
`packages/contracts/src/routes.ts`, or the transitional Next rewrite. The Gateway owns
HTTP adaptation and process lifecycle; Core owns framework-neutral behavior.

### 2. Signatures

- `GATEWAY_ROUTES: readonly { method, path, handler }[]`
- `GatewayHandler = (request: Request, params: Readonly<Record<string, string>>) => Response | Promise<Response>`
- `buildServer({ handlers?, closeResources? }): FastifyInstance`
- `GET /healthz -> { status: "ok", uptime: number, ts: number }`
- `GET /healthz/ready -> { status: "ready" | "unready", checks: { db, storage, queue }, ts }`
- Readiness in-flight keys: `db`, `storage`, and `queue`, each holding at most one raw
  dependency-check Promise.
- Required env: `DATA_ENCRYPTION_KEY` (64 hex), `BETTER_AUTH_SECRET`, `DATABASE_URL`
- Listener env: `GATEWAY_HOST` (default `0.0.0.0`), `GATEWAY_PORT` (default `4000`, integer `1..65535`)

### 3. Contracts

- `packages/contracts/src/routes.ts` is the single route matrix for Fastify registration. Do not duplicate path lists in the Gateway adapter.
- Gateway converts Fastify requests into standard Web `Request` objects and sends standard `Response` objects. Core handlers must not import Fastify or Next types.
- Preserve request headers and raw JSON bytes. Convert multipart input to `FormData` and let the runtime generate its new boundary headers.
- `/api/upload` accepts at most a 10 MiB file and 11 MiB body; `/v1/audio/transcriptions` accepts at most a 25 MiB file and 26 MiB body.
- Stream `Response.body` through the Node adapter without changing status, headers, SSE frame bytes, binary bytes, or Range responses.
- A raw request abort or response socket close aborts the Core `Request.signal`; cancellation must reach the upstream stream and must not start another attempt.
- `GET /healthz` is process liveness. Readiness uses independent 2-second DB, storage, and queue checks. DB must return `ok`, queue must return `{ available: true }`, and storage must initialize as the configured driver. A configured S3-compatible driver that falls back to local is unready.
- The 2-second timeout bounds each HTTP probe, not the underlying dependency operation.
  Repeated probes reuse the same unresolved Promise per dependency. The raw Promise is
  cleared only in its `finally`, so a recovered dependency can be checked again while a
  permanently hung dependency is limited to one outstanding operation.
- Closing Fastify closes queue and DB resources. Startup failure also closes any initialized resources, writes only `[gateway] 启动失败`, and exits with code `1`.
- Database bootstrap runs before listen. The default migration folder is `../../drizzle/pg` relative to the process working directory; launch through the package script or set `DRIZZLE_MIGRATIONS_DIR` explicitly.
- The production bundle includes all `@nekusora/*` workspace packages and leaves third-party packages external. Every third-party runtime import reachable from the bundle must therefore be a direct `apps/gateway` dependency.

### Production edge and process boundary

- `compose.production.yml` runs PostgreSQL, Redis, Web, Gateway, Worker, and an unprivileged edge-router. `compose.production.external.yml` omits PostgreSQL/Redis and connects every application process to external endpoints. Only edge-router publishes the application port; Web, Gateway, and Worker listen on the internal backend network (`3000`, `4000`, and `4001`).
- The edge route matrix is authoritative for production ingress: `/v1/*`, `/api/chat`, `/api/upload`, `/api/files/*`, `/api/images*`, and `/metrics` go to Gateway; `/api/auth/*`, pages, static assets, and `/_next/*` go to Web.
- Gateway SSE routes use `proxy_buffering off`; the edge preserves Host, Origin, Cookie, Authorization, and `X-Forwarded-*` headers. `/metrics` is denied by default and only allows `METRICS_ALLOW_CIDR`.
- Gateway and Worker share the named `uploads` volume and use an explicit absolute `LOCAL_STORAGE_DIR=/app/uploads`. Web does not mount this volume.
- Default pool budgets are Web 5, Gateway 10, and Worker 5 connections per replica. PostgreSQL capacity must cover `5 * WEB_REPLICAS + 10 * GATEWAY_REPLICAS + 5 * WORKER_REPLICAS + 20`.
- Rollback retains the previous shared application image tag and edge configuration. Restore those artifacts and restart Web, Gateway, Worker, and edge while preserving PostgreSQL, Redis, and uploads volumes; do not use `down -v` during rollback.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Required env missing/invalid | Fixed startup failure log, resources closed, exit `1` |
| `GATEWAY_PORT` outside `1..65535` | Fixed startup failure log, resources closed, exit `1` |
| DB bootstrap/migration failure | No listener; fixed startup failure log; exit `1` |
| `/healthz` while event loop serves requests | HTTP `200`, independent of dependency readiness |
| DB error/timeout | HTTP `503`, `status="unready"`, DB diagnostic preserved |
| Queue false/error/timeout | HTTP `503`, `status="unready"`, queue diagnostic preserved |
| Storage error/timeout or configured driver fallback | HTTP `503`, `status="unready"`, storage diagnostic preserved |
| Repeated probe after one dependency check hangs | HTTP `503` after 2 seconds; no second underlying check |
| Previously hung dependency check settles | Clear its in-flight slot; the next probe starts a fresh check |
| Fastify payload limit exceeded | Localized `request.payload_too_large`; Core handler is not called |
| Unexpected handler error | Localized `server.internal`; raw error/credential is not returned |

### 5. Good / Base / Bad Cases

- Good: Web is stopped while a real Gateway listener serves API-key `/v1/models` and `/v1/chat/completions`.
- Good: cancelling a client SSE read aborts the Core request and cancels the upstream stream.
- Good: a queue check hangs across ten probes; only one queue operation exists, and a
  later settlement lets probe eleven start a fresh check.
- Base: a finite JSON route preserves authorization headers, raw request bytes, response status, and body.
- Bad: add a route to Fastify and edge-router separately, allowing listener and ingress matrices to drift.
- Bad: bundle workspace packages but omit a transitive third-party runtime import from `apps/gateway/package.json`.
- Bad: log the bootstrap exception, database URL, credential, request body, or raw stack on startup failure.
- Bad: wrap a new DB/storage/queue Promise in `Promise.race` for every probe; the 2-second
  response timeout does not cancel those operations and lets them accumulate.

### 6. Tests Required

- `apps/gateway/src/server.test.ts`: route matrix, raw JSON/headers, multipart limits, safe localized errors, SSE bytes, readiness matrix, timer cleanup, resource close, repeated timeout single-flight, and retry after the raw check settles.
- `apps/gateway/src/server.listener.test.ts`: Gateway-without-Web requests and real-socket SSE cancellation. Use a `node:http` client and destroy the response socket after the first chunk; aborting Node's built-in `fetch` signal is not a portable assertion that the TCP socket closed across supported Node versions.
- Core route suites: API-key/session authorization, OpenAI JSON/SSE, WebChat SSE, file 200/206/302/416, images, knowledge, MCP, and metrics behavior.
- Production checks: `pnpm build:gateway`, missing-env exit `1`, successful `/healthz` + `/healthz/ready`, clean signal shutdown, and no leftover process or build fixture.

### 7. Wrong vs Correct

```typescript
// Wrong: framework-specific request handling leaks into shared domain code.
export async function v1Models(request: FastifyRequest, reply: FastifyReply) {}

// Correct: the application adapter owns Fastify and Core owns Web-standard contracts.
export type GatewayHandler = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Response | Promise<Response>;
```

```typescript
// Wrong: third-party dependencies are accidentally bundled or resolved transitively.
export default defineConfig({ bundle: true });

// Correct: bundle workspace code, externalize third-party runtime packages, and declare them directly.
export default defineConfig({
  bundle: true,
  noExternal: [/^@nekusora\//],
  skipNodeModulesBundle: true,
});
```

```typescript
// Wrong: fetch abort behavior differs between supported Node versions.
controller.abort();

// Correct: the listener test explicitly closes the real response socket.
response.once("data", () => response.destroy());
```

```typescript
// Wrong: every probe starts another operation that survives its outer timeout.
withTimeout(queueAvailable(), 2_000);

// Correct: share the raw operation; each probe still owns its 2-second wrapper.
withTimeout(runReadinessCheck("queue", async () => ({
  available: await queueAvailable(),
})), 2_000);
```
