# Technical Design

## Boundary

新增一个无依赖的服务端文本脱敏模块，并接入四个已证实边界：provider probe、chat stream/generate、multimodal adapters、usage/run audit。API route 与 UI 保持既有数据结构，不新增数据库字段或迁移。

## Data Flow

```text
raw upstream error + current apiKey/custom headers
  -> retry/status classification uses raw error
  -> redact exact secrets + credential-shaped text
  -> safe message
      -> ProbeResult -> Server Action -> provider health fields -> UI
      -> StreamEvent / GenerateChatResult -> WebChat or /v1 response
      -> multimodal adapter safe Error -> media routes / image_jobs
      -> logUsage generic backstop -> ops_error_logs
```

## Contracts

- `isSensitiveFieldName(name)` is the single field-name rule used by string and structured redaction.
- `redactSensitiveText(text, secrets?)` returns a string with exact non-empty secrets and recognized credential values replaced by `[REDACTED]`.
- `redactErrorMessage(error, secrets?, fallback?)` extracts only a safe message; it never returns the original Error object.
- Exact replacement is literal and longest-first so regex metacharacters and overlapping values cannot bypass redaction.
- Query parameter names include `key`, `api_key`/`api-key`/`apiKey`, access/refresh token, token, secret and password variants.
- Header/assignment forms cover Authorization/Bearer, `x-api-key`, sensitive JSON fields and `name=value` diagnostics.
- `classifyStreamError` classifies with the raw message, then returns the redacted message. Each catch retains the returned safe message for every downstream sink.
- Multimodal adapters throw a newly created Error containing only the safe message and no original `cause` or stack.
- `logUsage` applies generic redaction even when an upstream caller already sanitized; redaction is idempotent.

## Compatibility

- No API schema, error code, HTTP status, retry limit, route selection, metrics or database schema changes.
- Non-sensitive error messages remain readable and classification keyword matching still sees the raw source.
- Existing `toSafeJsonb` limits and `[REDACTED]` marker remain unchanged.

## Trade-Offs

- Central sink-only redaction cannot know arbitrary opaque keys; exact caller-side secrets are therefore required.
- Returning a fresh safe Error from media adapters loses the original upstream stack at downstream sinks. This is intentional because stack/cause can retain the secret; status and route context remain available separately.
- Historical records are not rewritten in this task to avoid an irreversible broad data mutation.

## Rollback

All changes are code-only. Reverting the shared helper integrations restores prior behavior; no data or environment rollback is required.
