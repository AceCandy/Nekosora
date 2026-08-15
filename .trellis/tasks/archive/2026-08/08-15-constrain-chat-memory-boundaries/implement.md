# Constrain Chat Memory Boundaries — Implementation Plan

## Success Criteria

- Low-information input cannot initialize Mem0 for recall, create an extraction job, or reach `memory.add`.
- Automatic extraction sends only eligible user-authored messages.
- Eligible text retains existing extraction and recall behavior with `threshold: 0.5`.
- Focused tests, Core type-check, Core lint, and final diff review pass.

## Steps

1. Add failing regression coverage.
   - Recall: `111` returns `[]` without `getMemory` or `search`; meaningful Unicode-letter input passes `threshold: 0.5` with the existing filters and `topK`.
   - Extraction: `111` returns `noop` before `getMemory` or `add`; assistant content is excluded; one meaningful user message remains eligible.
   - Extraction and job creation: scan backward for the most recent exact `role=user` message. Cover `earlier meaningful user + assistant + latest user 111 + assistant` so the earlier text cannot bypass the gate.
   - Job creation: low-information input returns `null`; the durable snapshot contains exact user messages only, with system/tool/unknown roles excluded rather than converted.
   - Mem0 initialization: configuration contains the conservative custom instructions.

2. Add the shared eligibility policy.
   - Implement the Unicode-letter test once in `memory/policy.ts`.
   - Reuse it in extraction/job creation and recall.

3. Constrain extraction.
   - Preserve the existing six-message window and 500-character limit.
   - Retain only exact `role=user` messages.
   - Gate on the most recent exact `role=user` message and skip low-information input before throttling and Mem0 initialization.
   - Preserve existing expiration, metadata, retry error, cache marking, and cache invalidation behavior for eligible input.

4. Constrain Mem0 initialization and recall.
   - Add conservative top-level `customInstructions` without changing provider configuration.
   - Add early recall no-op and `threshold: 0.5` without changing the public function signature.

5. Run focused verification.

   ```bash
   pnpm --filter @nekusora/core exec vitest run src/lib/memory/extract.test.ts src/lib/memory/jobs.test.ts src/lib/memory/recall.test.ts src/lib/memory/mem0.test.ts
   pnpm --filter @nekusora/core typecheck
   pnpm --filter @nekusora/core lint
   git diff --check
   ```

6. Run an independent Trellis quality review.
   - Check requirement coverage, call-chain consistency, test quality, and unrelated changes.
   - Fix only findings within this task's scope and rerun affected checks.

7. Update the memory-system specification.
   - Record the deterministic Unicode-letter gate, user-only extraction boundary, Mem0 custom-instruction role, and explicit recall threshold.

8. Commit the completed task after the user-approved implementation passes all checks.

## Rollback Points

- Before code changes: planning artifacts only; no runtime effect.
- After code changes: revert the focused memory files and tests; no schema or stored-data rollback.
- Do not delete or rewrite existing memories during rollback or verification.

## Not Included

- Full workspace compilation or test suite unless focused checks expose a cross-package issue.
- Production traffic validation or threshold benchmarking against a labeled dataset.
- Existing-memory audit, UI changes, or a new memory subsystem.
