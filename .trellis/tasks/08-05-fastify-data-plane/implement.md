# Implementation Plan

1. Extract framework-neutral contracts/errors and add adapter parity tests.
2. Extract DB/core/observability/queue modules with explicit dependency direction and no parallel implementations.
3. Create Fastify lifecycle, authentication helpers, health/metrics and safe shutdown.
4. Migrate `/v1/*` routes, then validate OpenAI finite/SSE contracts.
5. Migrate session data routes: chat, upload/files, images and knowledge; validate resource authorization and storage.
6. Add real-listener cancellation tests and Gateway-up/Web-down isolation test.
7. Switch selected Next paths to the internal proxy, prove browser URLs/cookies remain unchanged, then disable the rewrite and execute a real Web-handler rollback smoke before restoring the new path. Production retained-image rollback is deferred to `08-05-runtime-cutover`.
8. Review the dependency graph to confirm Gateway does not import Web code and Web has no parallel data-plane implementation. Record the remaining transitional Worker/readiness queue dependency for removal in `08-05-worker-queue-boundary`.

Validation: package lint/typecheck/tests, the explicit route matrix, Fastify inject suites, ephemeral SSE cancellation suite, existing frontend chat/image tests, Web build, Gateway production build/start smoke, and real Web-handler rollback smoke. Stop all listeners after checks.
