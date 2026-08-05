# Implementation Plan

1. Record baseline lint/typecheck/test, migration journal/snapshot digests, and the complete parent-owned route matrix: auth cookie, API-key auth, finite JSON, both SSE protocols, multipart upload, file/range binary responses, images, knowledge, MCP and audio.
2. Create the workspace root and move the current app/config/assets to `apps/web`; update aliases, Drizzle/scripts, Vitest and asset generation paths.
3. Upgrade/pin Next.js 16.3.0 and aligned tooling; apply documented breaking changes only.
4. Make the transitional Node dependency boundary statically analyzable and externalized.
5. Verify root orchestration, Turbopack dev cold start, production standalone build and Webpack fallback build.
6. Independently review path resolution, ignored/generated files, lockfile changes and public behavior.

Validation: `pnpm install --frozen-lockfile`, root lint/typecheck/test, Web Turbopack build, Web `--webpack` build, cold `/healthz` request, saved baseline matrix comparison and migration digest comparison. Stop every started server after checks.
