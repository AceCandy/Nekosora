# Constrain Chat Memory Boundaries

## Goal

Prevent transient or model-invented chat content from becoming long-term memory and influencing later conversations, while preserving useful recall for explicit, durable user context.

## Background

- A new conversation containing only `111` recalled an AI-generated project memory about a prior numeric query and caused the main assistant response to emit `**会话标题：** 111`.
- The four confirmed `111`/`222` polluted memories were deleted through the Mem0 API and independently verified absent. The remaining 58 memories are not approved for bulk deletion or migration.
- `packages/core/src/lib/memory/extract.ts` currently sends the last six normalized user and assistant messages to Mem0 with inference enabled.
- Mem0 3.1.6 defaults to exhaustive extraction from both user and assistant messages. The project does not configure `customInstructions`.
- `packages/core/src/lib/memory/recall.ts` requests five project memories without an explicit threshold. Mem0 therefore uses its native semantic threshold of `0.1`.
- Mem0 3.1.6 supports `MemoryConfig.customInstructions` and `SearchMemoryOptions.threshold`. Custom instructions are prompt-level guidance, not a deterministic enforcement boundary.
- Mem0's official guidance says applications should call `add` only for information worth reusing later and should separate conversation, session, and user memory. LangMem and Letta likewise use explicit or controlled memory writes with role-aware namespaces or prompts.

## Requirements

### R1. Deterministic low-information gate

- A current user input with no Unicode letters, including digits-only, symbols-only, whitespace-only, or emoji-only input, must not trigger project-memory recall.
- The same input must not create AI-extracted project memories after completion.
- This gate affects memory only; it must not suppress or rewrite the normal assistant response.

### R2. Conservative extraction policy

- Mem0 must receive explicit custom instructions that retain only durable user facts, preferences, ongoing projects, and user-confirmed decisions.
- Titles, labels, greetings, clarification prompts, transient requests, tool/search output, assistant speculation, and assistant-only recommendations must not become durable user intent.
- Automatic project-memory extraction must send only user-authored messages to Mem0. Assistant messages may remain in ordinary conversation context but cannot independently become durable user intent.
- An assistant suggestion becomes eligible only when the user explicitly confirms it in a later user-authored message; cross-turn confirmation inference is not part of this task.
- Prompt wording remains a secondary filter and is not the deterministic enforcement boundary.

### R3. Conservative recall policy

- Project-memory search must pass an explicit Mem0 semantic threshold instead of relying on the `0.1` default.
- The initial threshold is `0.5`: materially stricter than the current `0.1` default while carrying less false-negative risk than `0.7`.
- The threshold must be documented as a product trade-off and covered by a request-contract test; it is an initial product setting, not a universal Mem0 recommendation.
- Existing failure behavior remains unchanged: Mem0 errors return no recalled memories and do not block chat.

### R4. Compatibility and scope

- Existing manual preference/profile memories and their constant injection behavior remain unchanged.
- Existing project-memory expiration remains seven days.
- No schema migration, new dependency, UI change, or bulk mutation of the remaining 58 memories is in scope.
- Existing conversation messages, including the already persisted `会话标题：111` response, are not rewritten.

### R5. Regression coverage and specification

- Unit tests must reproduce the digits-only extraction and recall failures.
- Unit tests must assert the configured Mem0 extraction instructions and explicit recall threshold.
- `.trellis/spec/backend/memory-system.md` must record the final extraction and recall boundaries.

## Acceptance Criteria

- [x] `recallMemories(userId, "111")` returns `[]` without initializing or searching Mem0.
- [x] Memory extraction for a completed turn whose latest user message is `111` returns `noop` without calling `memory.add`.
- [x] A meaningful user message containing Unicode letters still reaches extraction and recall.
- [x] Mem0 initialization contains the approved conservative `customInstructions`.
- [x] Recall passes the approved explicit semantic threshold with `topK: 5` and the existing user/scope filters.
- [x] Assistant-generated title or clarification text cannot independently satisfy the deterministic extraction boundary.
- [x] Existing memory CRUD, expiration, caching, failure fallback, and normal assistant-response behavior remain unchanged.
- [x] Focused memory tests, Core type-check, Core lint, and diff checks pass.

## Out of Scope

- Bulk review or deletion of the remaining 58 memories.
- Retrofactive rewriting of persisted assistant messages.
- Memory-management UI changes or user-configurable thresholds.
- Reranker introduction or changes to the embedding model/vector dimension.
