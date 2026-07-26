# MAGI Round 10 Audit Candidates

## Selected: Provider error messages can disclose credentials

- `src/lib/providers/probe.ts:227-258,332-338` returns raw model/fetch errors while holding the current API key.
- Gemini uses a required query credential at `src/lib/providers/probe.ts:82-87`; a URL-bearing fetch error can therefore contain the complete key.
- Probe results flow into `lastKeyResults` / `lastModelProbeError`, Server Action responses and UI tooltips.
- `src/lib/stream.ts:191-219,323-347,653-679` forwards raw upstream messages into console, stream/generate results and attempt logs.
- Image/TTS/STT adapters throw upstream errors unchanged; their routes expose the message through HTTP, console and `ops_error_logs`.
- Selected as the highest-confidence confidentiality issue with repository-proven persistence and browser-visible paths.

## Deferred Candidates

1. Queue reliability: web processes can call pg-boss `send` before queues are started/created, dropping title and memory jobs while readiness remains 200.
2. Chat reference TOCTOU: parent/source can be tombstoned after validation but before insert/update, producing active orphan messages or updating deleted assistants.
3. MCP sub-key scope: model-bound sub keys currently search the owner's full RAG corpus; the intended resource authorization requires an explicit product decision.
4. Share resource bound: `createShare` accepts an unbounded message ID array and snapshot payload, allowing authenticated query/JSONB amplification.

## Priority Notes

- Credential disclosure outranks availability and data-integrity candidates because it can persist secrets and expose them to browsers.
- MCP scope is not selected because the repository does not define whether sub keys inherit the owner's full knowledge corpus.
