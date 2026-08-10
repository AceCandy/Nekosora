# Provider Timeout Contract

## Scenario: Enforce Provider Request Deadlines

### 1. Scope / Trigger

Apply this contract when changing Provider persistence, admin/panel Provider forms,
route resolution, Gateway attempt execution, SDK Provider construction, streaming,
multimodal adapters, hosted search, or Provider probe/discovery.

### 2. Signatures

- PostgreSQL `providers` columns: `connect_timeout_ms`, `read_timeout_ms`,
  `stream_idle_timeout_ms`; all are nullable integers.
- `PROVIDER_TIMEOUT_LIMITS` is the only owner of defaults and ranges:

| Field | Default | Allowed range |
| --- | ---: | ---: |
| `connectTimeoutMs` | `60_000` | `1_000..300_000` |
| `readTimeoutMs` | `900_000` | `10_000..3_600_000` |
| `streamIdleTimeoutMs` | `120_000` | `5_000..900_000` |

- Runtime helpers in `packages/core/src/lib/providers/timeouts.ts`:
  `resolveProviderTimeouts`, `parseProviderTimeoutFormData`,
  `pickProviderTimeoutConfig`, `createProviderTimeoutScope`, and
  `createProviderFetch`.
- Admin form fields use seconds: `connectTimeoutSeconds`,
  `readTimeoutSeconds`, `streamIdleTimeoutSeconds`; update forms send
  `providerTimeoutsPresent=1`.

### 3. Contracts

- `connectTimeoutMs` covers portable `fetch()` dispatch through receipt of
  response headers. Do not describe it as TCP-only.
- `readTimeoutMs` is one route/key attempt's total deadline through complete
  response-body or adapter consumption. The Gateway Engine owns this scope.
- `streamIdleTimeoutMs` is the maximum interval between SDK stream chunks and
  is passed as `timeout.chunkMs` only for streaming operations.
- `null` means use the system default. Zero, negative values, and explicit
  disable are not supported. UI values allow at most three decimal places so
  conversion to integer milliseconds is lossless.
- Registry Chat formats, hosted search, Image, TTS, and STT always install
  `createProviderFetch`; callers must preserve the SDK/caller signal.
- Provider timeout becomes `gateway.timeout`, HTTP 504, phase `network`, and a
  failed attempt. Before response commit it follows existing key/route fallback
  and breaker rules; after commit it terminates the current stream without
  switching upstream.
- Caller cancellation and service drain remain `interrupted` and do not count
  as ordinary Provider failure. Competing deadlines preserve the first reason.
- Probe/discovery uses the Provider configuration plus a stricter 15-second
  operation budget. Non-stream and stream fallback share that one budget.
  Unsaved direct key tests omit timeout fields and therefore use system defaults.
- Every scope must clear timers, remove parent listeners, and request iterator
  or reader closure on all success, failure, timeout, and cancellation paths.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Form field blank | Persist `null`; runtime resolves the documented default |
| Form value has more than 3 decimals, is non-finite, zero, or out of range | Server Action rejects before write |
| Direct database write is out of range | PostgreSQL CHECK rejects it |
| Provider connect/read/idle deadline wins | `gateway.timeout`, failed attempt, safe fixed message |
| Caller abort wins | `interrupted`; no ordinary breaker failure or fallback |
| Timeout before response commit | Existing failover policy may try another key/route |
| Timeout after response commit | End current stream; do not try another upstream |
| Probe Provider deadline exceeds 15 seconds | The 15-second probe budget wins |
| Probe Provider deadline is lower than 15 seconds | The Provider deadline wins |

### 5. Good / Base / Bad Cases

- Good: a Provider with a 5-second connect deadline stalls before headers; the
  upstream fetch is aborted, the attempt records `gateway.timeout`, and an
  eligible backup route is tried.
- Good: a stream emits one committed chunk and then idles; the same route ends
  with a timeout and no backup route starts.
- Base: all three database values are `null`; runtime uses 60s/15min/120s.
- Bad: applying `AbortSignal.timeout()` independently in an adapter and letting
  Engine classify its `AbortError` as client interruption.
- Bad: racing only `fetch()` and clearing all deadlines after headers, leaving
  response-body or stream consumption unbounded.

### 6. Tests Required

- Policy tests assert defaults, ranges, nullable form parsing, first abort
  reason, timer cleanup, and parent-listener removal.
- Engine fake-timer tests assert pre-commit fallback, post-commit stop, caller
  cancellation, breaker updates, iterator closure, and one finalization.
- Registry tests cover all four Chat wire formats; media tests cover Image,
  TTS, and STT signal/fetch wiring.
- Stream and hosted-search tests assert `chunkMs`, the 30-second hosted cap,
  continuous-chunk behavior, and idle timeout classification.
- Probe tests cover connect stalls, response-body stalls, shared non-stream /
  stream budget, configured `chunkMs`, redaction, and timer cleanup.
- Persistence changes require PostgreSQL SQL/journal/snapshot checks plus
  symmetric admin/panel create, update, preserve, clear, DTO, form, and i18n tests.

### 7. Wrong vs Correct

#### Wrong

```typescript
const response = await fetch(url, {
  signal: AbortSignal.timeout(15_000),
});
```

This bounds only that local call, loses Provider policy, and can collapse a
Provider timeout into generic cancellation.

#### Correct

```typescript
const timeouts = resolveProviderTimeouts(route.provider);
const scope = createProviderTimeoutScope(callerSignal, timeouts.readTimeoutMs, "read");
try {
  const response = await createProviderFetch({ connectTimeoutMs: timeouts.connectTimeoutMs })(url, {
    signal: scope.signal,
  });
  return await response.json();
} finally {
  scope.dispose();
}
```

The Engine remains the owner of attempt/fallback state; adapters only consume
the composed signal and protocol-specific idle timeout.
