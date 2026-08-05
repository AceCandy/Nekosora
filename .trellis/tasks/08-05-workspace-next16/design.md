# Design

- Add `pnpm-workspace.yaml`; keep the root package private and orchestration-only.
- Move the current Next application/config/assets into `apps/web` with history-preserving moves. Keep migrations at repository root and update explicit paths rather than duplicating them.
- Use Next.js 16.3.0 default Turbopack. Replace removed `next lint` usage with the existing ESLint 9 CLI.
- Configure standalone output tracing to the workspace root so required workspace files are included.
- Keep all current server code inside Web during this child. Externalize `mem0ai`, `pg-boss` and necessary Node runtime packages, and use a literal `import("pg-boss")` as a temporary valid boundary.
- Do not create shared package shells until the following child moves real code into them.

Rollback: restore the root package layout and lockfile; no database or public contract changes occur.
