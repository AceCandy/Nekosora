# 生产编排与无损切流

## Goal

Provide production-grade multi-process images and same-origin routing, cut public data traffic directly to Gateway, and remove transitional Web proxies after verified rollout.

## Requirements

- Build independently deployable Web, Gateway and Worker images/processes.
- Add an independent edge-router configuration that preserves public paths, headers, cookies and streaming without buffering.
- Compose PostgreSQL, Redis, Web, Gateway, Worker and edge routing with explicit health dependencies and shared upload volume.
- Document local development, production deployment, scaling, connection budgets and rollback.

## Acceptance Criteria

- [ ] Direct edge routing sends every owned path to the correct process with no public URL change.
- [ ] Edge route matrix explicitly sends `/v1/*`, `/api/chat`, `/api/upload`, `/api/files/*`, `/api/images*`, `/api/knowledge/search` and `/metrics` to Gateway; `/api/auth/*`, pages, assets and Next internals go to Web.
- [ ] SSE is unbuffered and cancellation reaches Gateway.
- [ ] Host, Origin, cookies, secure-cookie behavior and forwarding headers survive edge routing; production `/metrics` access is restricted to the configured scraper boundary.
- [ ] Web can be stopped while `/v1/*` remains available through Gateway replicas.
- [ ] Gateway/Worker share local uploads and all health checks converge.
- [ ] Health failure matrix passes: Web DB failure, Gateway DB/queue/storage failure, and Worker startup/runtime/shutdown states produce the designed readiness without conflating liveness.
- [ ] Transitional Next proxies and obsolete dynamic-import workarounds are removed.
- [ ] Clean compose build/start/smoke/stop succeeds without leaving services running.

## Out of Scope

- Cloud-vendor-specific Kubernetes or Terraform modules.
- Automatic multi-region database replication.
