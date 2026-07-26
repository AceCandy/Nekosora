# Implementation Plan

1. Add failing unit tests for exact-secret, URL query, Bearer/header, JSON assignment, idempotence and non-sensitive preservation.
2. Add failing Probe and Stream regression tests proving current keys cannot appear in returned events/results while classification remains unchanged.
3. Add a multimodal adapter regression proving an upstream Error containing the route key leaves the adapter with a safe message and stack.
4. Implement the shared redaction module; make run lifecycle reuse its field rule and redact embedded strings.
5. Integrate exact redaction into probe, chat stream/generate and image/TTS/STT adapters; add the `logUsage` persistence backstop and generic API catch protection.
6. Independently review every known sink from `research/provider-error-sinks.md` and verify no raw upstream Error crosses a boundary.
7. Update provider-probe, logging and error-handling code-specs; run focused tests, lint, typecheck, full Vitest, production build and diff checks.
8. Commit implementation, archive the task, record the journal, then continue to the next MAGI round.

## Risk And Rollback Points

- `src/lib/stream.ts`: raw Error must remain available for `isRetryableForKey`, `isFailoverableError`, status extraction and circuit breaker decisions.
- `src/lib/providers/multimodal/*`: catch only errors after route resolution so `RoutingError` mapping remains intact.
- `src/lib/usage.ts`: sanitize only `errorMessage`; do not alter errorCode/status/category inputs.
- `src/lib/chat/run-lifecycle.ts`: preserve depth, size, circular-reference and serialization behavior.

## Validation Commands

- `pnpm exec vitest run <focused test files>`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## Completion Gate

- No known provider-error sink receives a raw Error message containing configured credentials.
- Independent review has no blocking finding.
- All automated gates pass.
