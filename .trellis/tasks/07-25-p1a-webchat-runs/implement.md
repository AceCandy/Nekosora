# Implement: P1-A WebChat run lifecycle

## Checklist

1. [x] Add `src/lib/chat/run-lifecycle.ts` (start/finalize/tool-call/tool-result + safe jsonb)
2. [x] Add `src/lib/chat/run-lifecycle.test.ts`
3. [x] Wire `route.ts`: create runId, startRun, pass runId, handle tool events, finalizeRun, message.runId
4. [x] Run targeted vitest + `git diff --check`

## Validation

```bash
pnpm exec vitest run src/lib/chat/run-lifecycle.test.ts src/lib/stream-agent-loop.test.ts src/lib/stream.test.ts
git diff --check
```

## Rollback

Delete new module/test; revert route.ts run-related hunks only. Keep P0 files untouched.
