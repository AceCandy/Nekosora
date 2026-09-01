# CI And Container Publishing

> GitHub Actions quality gates and unified Web/Gateway/Worker container publishing contracts.

## Scenario: Repository Quality And Container Publishing

### 1. Scope / Trigger

Apply this contract when changing workspace scripts, `.github/workflows`, Dockerfiles,
published image names, Registry credentials, or deployment documentation.

### 2. Signatures

- `pnpm quality:workspace`
- `pnpm lint:workflows`
- `pnpm check`
- `pnpm test`
- `pnpm test:pg`
- PostgreSQL admin input: `DATABASE_URL`
- Core isolated database: `nekusora_core_pg_test_<16 lowercase hex>` with
  `TEST_DATABASE_URL` plus all four `*_PG_TEST_DATABASE` expectation variables
- API key isolated database: `nekusora_api_key_data_test_<16 lowercase hex>`
- `pnpm build`, `pnpm build:gateway`, `pnpm build:worker`
- PR/main Docker target: unified `nekusora`, `linux/amd64`, `push=false`
- Publish Docker target: unified `nekusora`, native `linux/amd64` and `linux/arm64` builds, `push=true`
- GHCR image: `nekusora`
- DockerHub image: `nekusora`, only for `v*` push tags

### 3. Contracts

- `.github/workflows/quality.yml` runs on pull requests and main pushes. Its unified
  Docker build depends on the complete source-quality job and never logs in to a Registry.
- `.github/workflows/docker-publish.yml` contains its own complete quality job. The
  mandatory chain is `quality -> ghcr_build -> ghcr_publish`; no publish job depends
  on another workflow run.
- Every workspace is registered in `scripts/workspace-quality.mjs`. All workspaces
  have `typecheck`; applications have lint/test/build; Core and Queue have lint/test.
  Contracts, DB, and Observability may omit tests only while their named exception
  remains accurate. Do not add no-op test scripts.
- GHCR is mandatory for schedule, `v*` push tag, and manual publish events. DockerHub
  is an independent optional copy after GHCR and must never change GHCR success.
- DockerHub credentials enter through job environment variables. Conditions use only
  a preflight boolean output and never inspect `secrets.*` directly.
- Workflow Actions use full commit SHAs. `actionlint` uses a fixed release checksum;
  Dependabot reviews GitHub Actions weekly.
- Publish one `nekusora` image containing all three application artifacts. Web,
  Gateway, and Worker remain separate containers with separate commands and health
  checks. Do not update the former `nekusora-web`, `nekusora-gateway`, or
  `nekusora-worker` images.
- Gateway and Worker bundles share the workspace-external `deploy/runtime` production
  manifest and frozen lock. Keep peer auto-install disabled for this isolated graph and
  reject Next, SWC, Vitest, Vite, esbuild, and `pdfjs-dist` from it. Do not copy two
  independent deploy stores.
- Build amd64 and arm64 on native GitHub-hosted runners and push platform digests
  first. Create edge, sha, and version tags only after both digests exist. Do not use
  QEMU to run dependency installation for the production image.
- Workflows do not load `.env.local` or persist Registry, database, or provider
  credentials in logs, outputs, labels, or caches. The private
  `deploy/production.env` stays excluded from Git and the Docker build context.
- Both quality jobs validate the development and production Compose files with
  the tracked production environment example before building the unified image.
- Both quality jobs provide a healthy `pgvector/pgvector:pg17` service and run
  `pnpm test:pg` as a separate step after `pnpm test`. Missing or unreachable
  PostgreSQL must fail the job instead of turning the integration step into skips.
- PostgreSQL orchestration accepts only `postgres:` / `postgresql:` URLs on
  `localhost`, `127.0.0.1`, or `::1`. It creates random prefix-guarded databases,
  migrates them, sets every suite's expected database name, and terminates connections
  before an exact guarded `DROP DATABASE ... WITH (FORCE)` in `finally`.
- The latest-schema Core suites share one freshly migrated isolated database. The API
  key data-path suite stays separate because it applies an audited pre-parent-removal
  fixture before the historical index/column migration. Do not truncate the current
  squashed migration journal to emulate that old schema.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unregistered workspace or missing declared script | `pnpm quality:workspace` fails |
| Workflow syntax or expression error | `pnpm lint:workflows` fails |
| Any source quality/build command fails | Docker validation and publishing do not run |
| Unified PR/main Docker build fails | Quality workflow fails; no image is pushed |
| Either native GHCR platform build fails | No tagged manifest is created; DockerHub is not attempted |
| DockerHub credentials missing | Image summary says skipped; GHCR remains successful |
| DockerHub login/copy fails | Image summary says failed; GHCR remains successful |
| Schedule freshness API/JSON fails | `skip=false`; quality and publish continue |
| Scheduled main SHA unchanged | Publish is skipped and the summary states why |
| PostgreSQL service health check fails | Quality fails before `pnpm test:pg` |
| `DATABASE_URL` is missing, remote, malformed, or unreachable | Orchestrator fails without creating a database |
| A PG suite, migration, or cleanup fails | `pnpm test:pg` returns non-zero; logs redact full PostgreSQL URLs |
| A database name does not match its exact random test prefix | Refuse create/drop operations |

### 5. Good / Base / Bad Cases

- Good: adding a workspace requires declaring its real quality scripts and updating the
  policy in the same PR.
- Good: a Tag creates semver/latest/sha tags for one manifest containing both platforms.
- Base: a manual publish sends sha, and edge only for main, to GHCR; DockerHub is not
  applicable even if the selected ref is a Tag.
- Good: Core reports four passed test files with no skipped tests, then the API key
  fixture reports its migration tests, and both random databases are removed.
- Base: normal `pnpm test` keeps PG files skipped; only the explicit `pnpm test:pg`
  entrypoint owns database setup and proves they executed.
- Bad: combine GHCR and DockerHub in one multi-Registry push, because an optional
  Registry outage then changes the mandatory publish result.
- Bad: put `always()` on DockerHub's job condition; it can bypass a failed dependency.
- Bad: use `--if-present` as the only evidence that every workspace is covered.
- Bad: point the API key script at the current migration directory and select an old
  numeric index; a squashed baseline may already contain the schema change.

### 6. Tests Required

- `scripts/workspace-quality.test.mjs`: registered policy, unknown workspace, missing
  script, and stale no-test exception coverage.
- `scripts/actionlint.test.mjs`: pinned version/checksum, download failure, and damaged
  archive rejection before extraction.
- `scripts/ci-workflows.test.mjs`: triggers, `needs`, permissions, native platform
  runners, atomic manifest creation, push behavior, Action SHAs, secret conditions,
  schedule fail-open behavior, image names, Compose commands, private environment
  exclusions, isolated runtime lock, and Dependabot schedule.
- `scripts/postgres-tests.test.mjs`: root/Web command wiring, local-only guard, all four
  Core suite variables/files, cleanup/redaction, and the audited API key fixture journal
  and SQL transition.
- Run `pnpm test:pg` against a real `pgvector/pgvector:pg17`; assert four Core files and
  the API key file pass with no skipped tests, then verify no prefixed database remains.
- Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, all three application
  builds, and the unified amd64 Docker build before merging. Verify the image is no
  larger than 1.5 GB and both runtime entrypoints resolve their declared dependencies.
- A real GitHub-hosted quality run and publish run remain required for Registry
  permission, multi-architecture, and job-summary verification.

### 7. Wrong vs Correct

```yaml
# Wrong: optional DockerHub can bypass or change mandatory GHCR publishing.
dockerhub_sync:
  needs: ghcr_publish
  if: always()
```

```yaml
# Correct: normal dependency semantics require both native platform builds and the
# GHCR manifest job to succeed.
dockerhub_sync:
  needs: ghcr_publish
  if: github.event_name == 'push' && github.ref_type == 'tag'
```

```yaml
# Wrong: PG files remain hidden inside normal Vitest discovery and silently skip.
- run: pnpm test

# Correct: service health gates a separate, visible integration step.
- run: pnpm test
- run: pnpm test:pg
  env:
    DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/postgres
```
