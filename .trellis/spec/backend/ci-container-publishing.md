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
  credentials in logs, outputs, labels, or caches.

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

### 5. Good / Base / Bad Cases

- Good: adding a workspace requires declaring its real quality scripts and updating the
  policy in the same PR.
- Good: a Tag creates semver/latest/sha tags for one manifest containing both platforms.
- Base: a manual publish sends sha, and edge only for main, to GHCR; DockerHub is not
  applicable even if the selected ref is a Tag.
- Bad: combine GHCR and DockerHub in one multi-Registry push, because an optional
  Registry outage then changes the mandatory publish result.
- Bad: put `always()` on DockerHub's job condition; it can bypass a failed dependency.
- Bad: use `--if-present` as the only evidence that every workspace is covered.

### 6. Tests Required

- `scripts/workspace-quality.test.mjs`: registered policy, unknown workspace, missing
  script, and stale no-test exception coverage.
- `scripts/actionlint.test.mjs`: pinned version/checksum, download failure, and damaged
  archive rejection before extraction.
- `scripts/ci-workflows.test.mjs`: triggers, `needs`, permissions, native platform
  runners, atomic manifest creation, push behavior, Action SHAs, secret conditions,
  schedule fail-open behavior, image names, Compose commands, isolated runtime lock,
  and Dependabot schedule.
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
