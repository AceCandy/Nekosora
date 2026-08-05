# Implementation Plan

1. Move worker entry/runtime/definitions/tests into their workspace ownership without changing behavior.
2. Finish queue package static imports and remove obsolete dynamic-import comments/workarounds.
3. Add internal health state/listener and integrate it with startup/shutdown ordering.
4. Configure Worker build/start/dev scripts, DB pool budget and local-storage volume contract.
5. Run unit and isolated PostgreSQL lifecycle suites; test repeated cross-signal shutdown.
6. Audit logs and build artifacts for payloads, credentials and Web queue dependencies.

Validation: Worker lint/typecheck/tests, queue PostgreSQL scripts, production build/start/health smoke and signal-drain smoke. Stop the Worker and health listener after checks.
