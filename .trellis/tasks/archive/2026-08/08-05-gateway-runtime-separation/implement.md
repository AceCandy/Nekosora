# Parent Execution Plan

The parent owns requirements and final integration only. Implement children in the task-map order; do not start the parent as an implementation target.

1. Complete and verify `08-05-workspace-next16`.
2. Complete and verify `08-05-fastify-data-plane` against the preserved HTTP contracts.
3. Complete and verify `08-05-worker-queue-boundary` against queue lifecycle and real PostgreSQL tests.
4. Complete and verify `08-05-runtime-cutover`, including container and direct-ingress smoke tests.
5. Run parent integration gate: install, lint, typecheck, full tests, all builds, compose health, public route smoke, Web-down/Gateway-up isolation, and sensitive-output audit.
6. Update architecture/spec documentation and archive children before archiving the parent.

Rollback is always to the previous completed child boundary. No child may rely on an uncommitted later child.
