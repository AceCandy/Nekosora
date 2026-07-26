# Provider Error Sink Inventory

## Exact-Secret Boundaries

- `src/lib/providers/probe.ts`: owns `apiKey` and custom headers before returning `ProbeResult`.
- `src/lib/stream.ts`: owns each attempted `tryKey` before logging, console output and StreamEvent/GenerateChatResult construction.
- `src/lib/providers/multimodal/image-gen.ts`: owns the selected route key before `generateImage` errors leave the adapter.
- `src/lib/providers/multimodal/audio-tts.ts`: owns the selected route key before `generateSpeech` errors leave the adapter.
- `src/lib/providers/multimodal/audio-stt.ts`: owns the selected route key before `transcribe` errors leave the adapter.

## Downstream Sinks

- Probe: admin/panel direct test responses, `lastKeyResults`, `lastModelProbeError`, health/model UI tooltips.
- Chat: `src/app/v1/chat/completions/route.ts` streaming and non-streaming responses; `src/app/api/chat/route.ts` SSE.
- Media: `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/api/images/generate` HTTP/console/log/job fields.
- Persistence: `src/lib/usage.ts` writes `params.errorMessage` to `ops_error_logs.errorMessage`.
- Structured audit: `src/lib/chat/run-lifecycle.ts` stores tool arguments/results after `toSafeJsonb` normalization.

## Required Review Invariant

Raw errors may be used for in-process classification and retry decisions, but no raw error string may cross into the downstream sinks above.
