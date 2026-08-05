# Design

- Produce separate Docker build targets/images for Web, Gateway and Worker from the workspace lockfile.
- Use a dedicated edge-router service for production path dispatch. Route `/v1/*`, `/api/chat`, `/api/upload`, `/api/files/*`, `/api/images*`, `/api/knowledge/search` and `/metrics` to Gateway; route `/api/auth/*`, pages, assets and Next internals to Web. Disable response buffering for SSE paths, preserve forwarding headers, and restrict `/metrics` at the edge.
- Keep Gateway and Worker ports internal. Only the edge router publishes the application port.
- Compose mounts one upload volume into Gateway and Worker and uses direct per-service health checks. PostgreSQL and Redis remain independent stateful services.
- Remove Next transitional rewrites only after the explicit direct-edge route and health matrices pass.
- Retain the previous Web image and edge configuration through the observation window. Rollback is exercised by restoring those exact artifacts; database and queue schemas remain compatible.
