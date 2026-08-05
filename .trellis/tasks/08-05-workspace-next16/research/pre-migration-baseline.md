# Pre-Migration Baseline

Recorded on 2026-08-05 before moving the application to `apps/web`.

## Quality Gates

- `pnpm install --frozen-lockfile`: passed; lockfile unchanged.
- `pnpm lint`: passed with the expected Next 15 `next lint` deprecation notice.
- `pnpm typecheck`: passed.
- `pnpm test`: 125 files passed, 2 skipped; 1122 tests passed, 17 skipped.
- `pnpm build`: failed after emitting the expected `src/lib/infra/queue.ts` critical dependency warning. The existing `/api/upload` route also exported `MAX_UPLOAD_FILE_BYTES`, which Next rejects as an invalid Route Handler export.

## Route Contract Matrix

| Surface | Baseline contract and evidence |
| --- | --- |
| Better Auth | `/api/auth/*` remains the same-origin cookie endpoint family and returns Better Auth's JSON/cookie responses. `src/auth.test.ts` covers configured fields; no live-cookie integration test existed. |
| API-key auth | Missing or invalid bearer keys return the localized OpenAI error JSON with 401 before route work. `/v1/models` and `/v1/mcp` tests cover master/sub-key visibility with mocked verification; no real-key HTTP integration test existed. |
| `/v1/models` | 200 JSON `{ object: "list", data }`; master keys see enabled owner models and sub-keys only their enabled binding. |
| `/v1/chat/completions` SSE | 200 `text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`; content/finish/usage `data:` frames terminate with `data: [DONE]`. Route tests cover completion, errors, and cancellation. |
| `/v1/chat/completions` finite JSON | 200 JSON OpenAI `chat.completion` with `choices` and `usage`; validation/auth/upstream failures use the existing OpenAI error JSON/status mapping. No dedicated finite-response regression existed before migration. |
| `/api/chat` SSE | Session required (401); validation/ownership branches retain 400/403/409. Success is 200 `text/event-stream; charset=utf-8` with no-cache/keep-alive headers, domain-event frames, terminal frame, and `[DONE]`; tests cover completion, failure, and cancellation. |
| Multipart upload | Session required (401); malformed/missing file 400, foreign conversation 403, body/file limit 413, success 200 JSON `{ fileId, filename, status: "processing" }`. Tests cover storage/DB/queue flow, cleanup, and synchronous fallback. |
| File delivery | Session 401, absent/foreign file 404, read failure 500, private object 302, full body 200, valid range 206, invalid range 416. Binary responses retain `Content-Type`, `Content-Length`, inline disposition, `Accept-Ranges`, private no-store, and range-specific `Content-Range`. |
| Images | `/v1/images/generations` returns 200 OpenAI-compatible JSON and has validation/error tests. `/api/images` returns session 401 or 200 `{ jobs }`; `/api/images/generate` returns 401/400/500 or 200 `{ jobId, urls }`. The two session routes had no route-level regression before migration. |
| Knowledge search | `/api/knowledge/search` returns session 401, validation 400, empty 200 `{ status: "empty", chunks: [] }`, or result 200 JSON. Service/RAG tests existed, but no route-level regression existed. |
| MCP | POST returns 200 JSON-RPC success/error envelopes; missing/invalid keys use JSON-RPC code `-32001`; GET returns 405 JSON. Route tests cover key-scoped `list_models`; registry/connection tests cover qualified tool routing and lifecycle. No live MCP server integration test existed. |
| Audio | Transcription returns auth/validation errors or 200 JSON `{ text }`, with multipart body/file limit 413. Speech returns errors or 200 audio bytes with upstream `Content-Type`. Tests cover limits, success headers/body, and sanitized errors. |

The complete pre-move Vitest suite is the behavioral comparison gate. Missing route-level cases above are baseline coverage gaps, not claims of changed behavior.

## Drizzle Artifact Digests

```text
3fec68fc777efd40898da6d0bc06fd658a8f0b7ebd8fe9cba8f3949424f5c252  drizzle/pg/0000_baseline.sql
f12dd70266b6ceed7aaa682f1007984e253fd9682b73b1c1a446165fe790a158  drizzle/pg/0001_adorable_dragon_lord.sql
8a5e3b1c0b7b93319ef2ce17f0444379735a1f88eb87b031ef37b7485e7fc2ea  drizzle/pg/0002_wet_hellcat.sql
11822ee2598955603dac2afb72148542dd33d2fd8126872d0663d26cbb5655be  drizzle/pg/0003_model_catalog_sync.sql
b09659d07d49d91a034f902965771d263b70c2d6196f7c6464acd4eb75f8bb2c  drizzle/pg/0004_model_catalog_web_search.sql
e418a6c0e4c67ea0392fb3291e909c79b5b43d25defef4152f744178f0884863  drizzle/pg/0005_stale_rick_jones.sql
85feece5022887c83d202dee31ebc2ef10ede80f8350e313fd3c76ad7e3ba163  drizzle/pg/0006_daily_wonder_man.sql
7f8e25f8588d1bd2af5241141451559db71786ac88184be0f3ffa1a55311e415  drizzle/pg/meta/0000_snapshot.json
b4c5dbe199a8b0c66db76b076f7d128f7c08c646164b951f20cb4241c93b23c9  drizzle/pg/meta/0001_snapshot.json
fb559dc1420bda3f59e50387cd68b7d2ed67e26a2c1d786b0699db23fdfc0cfd  drizzle/pg/meta/0002_snapshot.json
84a3018a10a8f34226fe5e6b7325c1f31085756fedad793258896ebef5f6fa02  drizzle/pg/meta/0003_snapshot.json
46c0250c4372457d45ef6358eea82bb5dac445fb15762c16a7dc8e3d8cd384c1  drizzle/pg/meta/0004_snapshot.json
84253f8b806d88c1539dec15eef7637ab31932c8bb32ad8137446228f61a3db7  drizzle/pg/meta/0005_snapshot.json
40816cc70c5815bd68f013b363f38da7dc99b05fa0ba3d2c6ed69b7faec41035  drizzle/pg/meta/0006_snapshot.json
effa643a7cd41b92b54122fb3561a211e33234d2d46eaf7164ad34d82fe48cab  drizzle/pg/meta/_journal.json
```
