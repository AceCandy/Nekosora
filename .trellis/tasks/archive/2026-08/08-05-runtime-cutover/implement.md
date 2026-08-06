# Implementation Plan

1. Add reproducible Web/Gateway/Worker Docker targets with non-root runtime users and minimal required files.
2. Add edge-router routing and SSE/header rules.
3. Expand Compose with app services, health checks, pool budgets and shared upload volume.
4. Run the explicit direct-ingress route matrix, forwarded auth/header checks, health failure matrix, cancellation and Web-down/Gateway-up tests.
5. Remove temporary Next proxies and obsolete compatibility code; rebuild and repeat smoke tests.
6. Exercise rollback using the retained previous Web image and edge configuration, then restore the new deployment.
7. Update README/environment/deployment documentation and perform secrets/generated-artifact audit.
8. Stop and remove all debug services/containers created by validation.

Validation: clean image builds, compose config validation, healthy startup, public route matrix, SSE cancellation, isolation test, graceful shutdown and clean teardown.
