# pnpm workspace 与 Next 16

## Goal

Create the pnpm workspace foundation, move the existing application to `apps/web`, and upgrade it to stable Next.js 16 with default Turbopack without changing public behavior or endpoint ownership.

## Requirements

- Preserve every existing page, Route Handler, Server Action, test, migration and script.
- Pin Next.js and `eslint-config-next` to reviewed stable 16.3.0; keep React 19 compatibility.
- Root scripts must orchestrate workspace install, dev, lint, typecheck, test and build.
- Next standalone tracing, messages, public assets, Drizzle paths and generated PDF assets must work from the new location.
- Replace the queue variable-path import with a literal/externalized transitional boundary so the Next 16 build is valid before data-plane extraction.

## Acceptance Criteria

- [ ] `pnpm install --frozen-lockfile`, lint, typecheck and the existing test suite pass from the repository root.
- [ ] `apps/web` starts with Turbopack and builds a standalone artifact with no critical dependency/module-resolution warning.
- [ ] A Webpack fallback build remains available for comparison.
- [ ] Existing routes and database migrations are behaviorally unchanged.
- [ ] A baseline route matrix records status/body/header/auth behavior for `/api/auth/*`, `/v1/models`, finite and streaming `/v1/chat/completions`, `/api/chat`, upload/file range reads, image routes, knowledge search, MCP and audio routes; migration journal/snapshot digests are unchanged.
- [ ] No empty shared package or speculative abstraction is introduced.

## Out of Scope

- Moving HTTP ownership to Fastify.
- Changing the Worker lifecycle or production ingress.
