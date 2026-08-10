# Gateway Request Governance

## Scenario: API-Key Rate, Concurrency, And Quota Governance

### 1. Scope / Trigger

Apply this contract when changing an API-key-authenticated Gateway endpoint,
governance policy or administration, Provider/RAG admission, request lifecycle,
quota metering, media usage telemetry, or the governance PostgreSQL schema.

### 2. Signatures

- Settings row: `system_settings(namespace='gateway', key='request_governance_v1')`.
- Policy: `GatewayGovernancePolicy` with `version: 1` and complete `key` / `user`
  limits for RPM, burst, concurrency, and four monthly quotas.
- Operations: `chat.stream | chat.generate | image.generate | audio.speech |
  audio.transcription | mcp.search`.
- Quota kinds: `chat_tokens | image_count | tts_code_points | stt_seconds`.
- Lifecycle entrypoints: `consumeGatewayGovernanceRate`,
  `acquireGatewayGovernanceLease`, `beginGatewayGovernance`, and
  `GatewayGovernanceHandle.{reserveQuota,markProviderStarted,finalize}`.
- PostgreSQL facts: `gateway_governance_subjects`, `gateway_quota_windows`, and
  `gateway_governance_leases`.
- Media telemetry: `IRUsage.{imageCount,ttsCodePoints,sttSeconds}` maps to the
  same nullable columns on `gateway_executions` and `gateway_attempts`.

### 3. Contracts

- PostgreSQL is the only admission source of truth. Repository or policy-read
  failures fail closed as `server.service_unavailable`; do not fall back to
  Redis, process-local counters, or telemetry.
- Every API-key-authenticated operation in the Endpoint Matrix, including
  Gemini `/v1beta/models/*`, consumes both its API-key and owning-user rate
  buckets after authentication and before semantic body parsing. Provider/RAG
  operations also hold one dual-scope lease.
- One client request owns one lease across route/key retries, tool fallback, and
  all Provider attempts. Quota is reserved once before the first Provider
  attempt and settled once at the outer terminal boundary.
- Chat reserves estimated tokens. Image reserves validated `n`. TTS uses the
  same Unicode code-point count for its 4096 limit and quota. STT reserves
  `ceil(durationSeconds)` only after content-based audio duration validation.
- Lease TTL is 120 seconds and heartbeat cadence is 30 seconds. Both use the
  PostgreSQL clock and are not administrator-configurable. Quota windows are
  UTC calendar months and settlement uses the month stored on the lease.
- Transaction lock order is existing lease IDs in ascending order, key subject,
  user subject, key quota window, then user quota window. No path may acquire a
  lease after a subject lock.
- A freshness decision made before waiting on a row lock is invalid. After the
  lease lock is acquired, execute a new `statement_timestamp()` query, and keep
  `lease_expires_at > statement_timestamp()` on the final heartbeat or
  Provider-start `UPDATE`. A late heartbeat must never revive an expired lease.
- Before Provider start, finalization refunds the full reservation. After
  Provider start, reliable actual usage is charged; missing, failed, cancelled,
  or abandoned usage charges the reservation. Actual usage above reservation is
  recorded as overage and blocks later admission instead of being truncated.
- `finalize` and the reaper lock and delete the same lease in one transaction.
  The lock winner settles; a duplicate or late terminal path is a no-op.
- Successful Image, TTS, and STT attempts set only their applicable media usage
  field. Non-applicable, rejected, failed-without-usage, and interrupted facts
  store `null`, not a fabricated token or request count. Telemetry remains
  best-effort and never controls admission or settlement.
- Policy form input is a complete, strict, bounded safe-integer object. The
  Server Action authenticates with `requireAdmin`, parses the whole group, and
  saves it with one `INSERT ... ON CONFLICT DO UPDATE`. Invalid stored JSON uses
  the safe defaults and surfaces a configuration warning.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Key or user rate bucket exhausted | HTTP 429 `gateway.rate_limit_exceeded`; integer `Retry-After`; no body parse or upstream |
| Key or user concurrency exhausted | HTTP 429 `gateway.concurrency_limit_exceeded`; no upstream |
| Monthly quota exhausted | HTTP 429 `gateway.quota_exceeded`; no upstream |
| Governance repository, admission, or Provider-start fails | HTTP 503 before commit; no Provider retry, failover, or breaker update |
| Heartbeat or settlement fails after stream commit | Abort current upstream and emit the protocol-native unavailable terminal; do not report success |
| Lease expires while waiting for its row lock | Provider-start/heartbeat/reserve fails; lease is not revived |
| Provider never started | Refund reservation and delete lease |
| Provider started but usage is missing | Move the reservation from reserved to used |
| Final actual usage exceeds reservation | Charge actual usage and mark settlement overage |
| Finalize races reaper | Exactly one settles and deletes; the loser is a no-op |
| Stored policy is missing | Use `DEFAULT_GATEWAY_GOVERNANCE_POLICY` |
| Stored policy is invalid | Use defaults and record the fixed `policy_invalid` failure stage |

All governance 429 responses include `X-Gateway-Error-Code`. Chat protocols keep
their native envelope; Provider 429 responses remain upstream failures and are
not converted into client quota state.

### 5. Good / Base / Bad Cases

- Good: two subkeys consume independent key buckets while sharing the same user
  bucket, so adding subkeys cannot bypass the user limit.
- Good: a heartbeat waits behind a lease lock until expiry, then its fresh SQL
  statement rejects instead of extending the lease.
- Good: an Image request reserves two images, receives one, refunds one, and
  records `imageCount=1` with the other media fields null.
- Base: one successful Chat request reserves once, marks Provider start once,
  charges actual tokens, and deletes its lease.
- Bad: creating a new lease per route attempt multiplies concurrency and quota
  charges for one client request.
- Bad: using transaction-start `now()` after a lock wait or updating only by ID
  can revive a lease that expired while waiting.
- Bad: writing Image/TTS/STT units into token columns makes usage and quota
  semantics unverifiable.

### 6. Tests Required

- Policy tests assert defaults, complete strict parsing, safe-integer bounds,
  canonical fingerprint stability, invalid stored fallback, and atomic save.
- HTTP tests cover OpenAI Chat/Responses, Anthropic, Gemini generate/stream,
  Image, TTS, STT, Models, and MCP. Every rejection test asserts the Provider or
  RAG function was not called plus `Retry-After` and `X-Gateway-Error-Code`.
- Engine/stream tests assert one lease across retries/fallback, strict
  Provider-start, pre/post-commit failures, Abort/cancel, heartbeat failure,
  settlement-before-success, and one finalization.
- Real PostgreSQL tests use independent connections and confirm lock waiting via
  `pg_stat_activity`. Cover acquire/finalize, reap/finalize, reap/heartbeat,
  reap/Provider-start, reserve/reap, wait-across-expiry, and duplicate terminal
  settlement.
- Metering tests cover Chat fallback, Image actual count, Unicode surrogate
  pairs, TTS 4096 boundary, supported/corrupt STT audio, missing usage,
  reservation refund, conservative settlement, and overage.
- Telemetry tests assert media fields on attempts and executions, with `null`
  for all non-applicable fields.
- Migration tests assert SQL, journal, snapshot, both subject foreign keys,
  delete behavior, checks, indexes, and nullable media columns.

### 7. Wrong vs Correct

```typescript
// Wrong: each attempt owns governance and may reserve again.
for (const route of routes) {
  const handle = await beginGatewayGovernance(input);
  await handle.reserveQuota(kind, units);
  await invoke(route);
}

// Correct: the HTTP boundary owns one handle for the complete logical request.
const handle = await beginGatewayGovernance(input);
await handle.reserveQuota(kind, units);
await runWithGatewayGovernance(handle, () => executeAcrossRoutes(handle));
```

```sql
-- Wrong: a lease may expire while this UPDATE waits for its row lock.
UPDATE gateway_governance_leases
SET lease_expires_at = statement_timestamp() + interval '120 seconds'
WHERE id = $1;

-- Correct: lock first, re-read database time in a new statement, and retain
-- the freshness predicate on the final write.
UPDATE gateway_governance_leases
SET lease_expires_at = statement_timestamp() + interval '120 seconds'
WHERE id = $1
  AND lease_expires_at > statement_timestamp();
```
