# Implementation Plan

1. Split driver-neutral Queue types from the pg-boss adapter and add the Core Queue provider boundary.
2. Configure the provider in Gateway/Worker; ensure Web title/memory dispatch does not claim durable work without a provider.
3. Add the independent Worker entry, build configuration and native health listener while preserving the existing Core runtime/definition behavior.
4. Remove the Web consumer entry, queue readiness check, pg-boss dependencies and obsolete build workaround.
5. Configure root Worker scripts, DB pool budget and local-storage volume contract.
6. Run unit and isolated PostgreSQL lifecycle suites; test readiness and repeated cross-signal shutdown.
7. Audit logs, imports and build artifacts for payloads, credentials and Web pg-boss/consumer dependencies.

Validation: Worker lint/typecheck/tests, queue PostgreSQL scripts, production build/start/health smoke and signal-drain smoke. Stop the Worker and health listener after checks.
