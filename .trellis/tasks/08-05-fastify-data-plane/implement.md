# Implementation Plan

1. Extract framework-neutral contracts/errors and add adapter parity tests.
2. Extract DB/core/observability/queue modules with explicit dependency direction and no parallel implementations.
3. Create Fastify lifecycle, authentication helpers, health/metrics and safe shutdown.
4. Migrate `/v1/*` routes, then validate OpenAI finite/SSE contracts.
5. Migrate session data routes: chat, upload/files, images and knowledge; validate resource authorization and storage.
6. Add real-listener cancellation tests and Gateway-up/Web-down isolation test.
7. Retain the pre-proxy Web image/configuration, switch selected Next paths to the internal proxy, prove browser URLs/cookies remain unchanged, then execute a rollback smoke against the retained image before restoring the new path.
8. Review dependency graph to confirm Web no longer imports `packages/queue` or Gateway route code.

Validation: package lint/typecheck/tests, the explicit route matrix, Fastify inject suites, ephemeral SSE cancellation suite, existing frontend chat/image tests, Web build, Gateway production build/start smoke, and retained-image rollback smoke. Stop all listeners after checks.
