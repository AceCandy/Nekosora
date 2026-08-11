# Circuit Breaker Execution Boundary Research

## Confirmed Facts

- `packages/core/src/lib/circuit-breaker.ts:67-80`: `isProviderAllowed()` mutates an expired `open` breaker to `half-open`; the first caller therefore owns the only probe implicitly.
- `packages/core/src/lib/routing.ts:192-194`: route filtering returns the original route set when no route is allowed, bypassing both `open` and occupied `half-open` states.
- `packages/core/src/lib/circuit-breaker.ts:130-134`: `filterAllowedOrFallback()` contains the same fail-open behavior and has no production caller.
- `packages/core/src/lib/gateway-execution/engine.ts:91-120`: adapter rejection records a rejected attempt but does not report a breaker result.
- `packages/core/src/lib/gateway-execution/engine.ts:128-152`: Provider-start failure or cancellation exits before a real attempt and does not report a breaker result.
- `packages/core/src/lib/gateway-execution/engine.ts:163-249`: a successful adapter attempt records telemetry and then calls `recordSuccess()`.
- `packages/core/src/lib/gateway-execution/engine.ts:250-328`: Provider timeout and ordinary failoverable failures call `recordFailure()`; caller cancellation, deterministic errors, tool rejection, and stream-options compatibility fallback do not.
- `packages/core/src/lib/routing.ts:241-255`: capability routing reads `routes[0]`; returning an empty array from filtering would misclassify breaker exhaustion as unsupported capability.
- `packages/core/src/lib/errors.ts:117-121`: `routing.no_route` already maps to HTTP 503, but there is no distinct no-healthy-route code.
- `packages/core/src/lib/protocols/encoders.ts:57-109`: stable codes are normalized through shared metadata and then wrapped per ingress protocol.
- `packages/core/src/lib/gateway-execution/telemetry.ts:54-101`: final execution facts already persist outcome error code and phase.
- `packages/observability/src/index.ts:48-69`: existing execution/attempt metrics intentionally avoid Provider, route, model, request, and Key labels.

## Root Cause

The probe is acquired in route resolution but only the Engine can observe every terminal path. A boolean query cannot transfer ownership, and fail-open fallback then discards the breaker's refusal entirely.

## Minimal Reliable Boundary

1. Route resolution performs a pure availability read and never acquires a probe.
2. The Engine acquires an explicit Provider permit around one bounded route execution.
3. A token protects half-open settlement from duplicate or stale callbacks.
4. `finally` releases neutral terminal paths; only Provider success/failoverable failure changes health.
5. Both routing exhaustion and the inspect/acquire race return one stable no-healthy-route error.

## Decision Notes

- Neutral release restores `open` while preserving the already elapsed `openUntil`; this avoids permanent `half-open` without pretending the Provider recovered or imposing a new cooldown for a client-side outcome.
- No `Retry-After` is emitted. A cooling `open` breaker has a timestamp, but an occupied probe has no reliable completion estimate.
- One fixed-label breaker event counter is sufficient. Existing execution facts remain the durable request-level log; a new logging subsystem is unnecessary.
