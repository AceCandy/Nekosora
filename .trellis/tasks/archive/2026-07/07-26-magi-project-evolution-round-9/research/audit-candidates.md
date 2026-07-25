# MAGI Round 9 Audit Candidates

## Selected: S3 public URL bypasses private file authorization

- `S3Driver.signedUrl()` returns a permanent bare `publicBaseUrl/key` when configured.
- The owner-checked private file route redirects to that URL, so later requests bypass application authorization and TTL.
- Selected because it directly affects user-file confidentiality and contradicts the existing private-file spec.

## Deferred Candidates

1. Chat reference TOCTOU: a parent/source can be soft-deleted after validation and before insert, creating visible orphan branches; continue can update a newly tombstoned assistant.
2. Secret boundary: Gemini probe puts a key in the URL query, and raw upstream errors can flow to logs and external API responses without redaction.
3. Queue reliability: Web processes send pg-boss jobs without starting the adapter; title and memory jobs may be dropped, while readiness still reports healthy.
4. MCP sub key: model-bound sub keys can call `search_knowledge` across the owning user's full RAG corpus; intended resource scope needs an explicit contract.
5. Share resource bound: `createShare` accepts an unbounded message ID array, allowing authenticated resource exhaustion.

## No New Finding

- The public-share authorization and snapshot chain showed no additional privacy bypass after rounds 4 through 7.
