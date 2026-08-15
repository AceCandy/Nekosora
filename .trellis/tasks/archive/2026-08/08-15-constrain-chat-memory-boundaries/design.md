# Constrain Chat Memory Boundaries — Design

## Summary

Add deterministic application-level gates around the existing Mem0 integration. Keep the current background extraction, storage, expiration, and recall architecture; change only which text is eligible, which roles reach Mem0, and the minimum recall similarity.

## Current Data Flow

```text
completed chat
  -> createMemoryExtractionJob(recent user + assistant messages)
  -> durable memory-extraction row
  -> Worker extractMemories
  -> Mem0 add(infer=true, scope=project, expires in 7 days)

new user message
  -> prepareChatContext
  -> recallMemories(userContent)
  -> Mem0 search(topK=5, threshold defaults to 0.1)
  -> project-memory prompt slot
```

The defect is caused by allowing assistant-generated text to become a candidate user fact and by recalling weakly related project memories for low-information queries.

## Target Data Flow

```text
completed chat
  -> normalize only role=user messages from the existing recent window
  -> most recent exact role=user text contains a Unicode letter?
       no  -> do not create a job / Worker returns noop for an existing job
       yes -> Mem0 add with conservative custom instructions

new user message
  -> query contains a Unicode letter?
       no  -> return [] before Mem0 initialization
       yes -> Mem0 search(topK=5, threshold=0.5, existing user/scope filters)
```

## Design Decisions

### Shared deterministic eligibility policy

Add one memory-policy helper that returns true only when text contains a Unicode letter using `\p{L}` with the Unicode regular-expression flag. Both extraction and recall use the same helper.

- Chinese, Latin, and other alphabetic scripts remain eligible.
- Digits, punctuation, whitespace, and emoji alone are ineligible.
- Mixed input such as `项目 111` remains eligible.

A shared helper avoids separate extraction and recall rules drifting over time. No configuration is added because the requested behavior is a product boundary, not a user-tunable preference.

### User-authored extraction only

`normalizeMemoryMessages` keeps the existing six-message recency window, then retains only messages whose original role is exactly `user`. Unknown, system, tool, and assistant roles are excluded rather than coerced to user.

Each durable message remains capped at 500 characters. If its first Unicode letter appears after the initial 500 characters, normalization starts the bounded window at that letter so truncation cannot change an eligible input into an ineligible Worker payload.

The gate scans backward for the most recent exact `role=user` message and evaluates that message, not the final array element. This matters because the completed transcript normally ends with an assistant response. Earlier meaningful user text must not make a later digits-only user turn eligible.

One eligible user message is sufficient to create and process an extraction job. The previous two-message minimum existed because the payload normally contained a user/assistant pair; retaining it after removing assistant messages would silently disable first-turn extraction.

Eligibility is checked twice:

1. Job creation skips new low-information durable rows.
2. Worker extraction returns `noop` before throttling or Mem0 initialization, protecting already-persisted jobs and direct callers.

Assistant suggestions are not sent to Mem0. If the user later confirms a suggestion, that user-authored confirmation is independently eligible.

### Conservative Mem0 instructions

Set top-level `MemoryConfig.customInstructions` during client initialization. The instruction permits only durable user facts, stable preferences, ongoing projects, and user-confirmed decisions; it rejects titles, greetings, clarification text, transient requests, tool/search output, assistant speculation, and assistant-only recommendations.

This is defense in depth. The deterministic role and content gates remain authoritative because Mem0 instructions are interpreted by an LLM.

### Conservative recall

Keep the public `recallMemories` signature and caller behavior unchanged. Add an early eligibility return before `getMemory`, then pass `threshold: 0.5` alongside the existing `topK` and filters.

The value is intentionally explicit and test-covered. It is a balanced initial setting, not an industry-standard score; future calibration requires representative positive and negative recall examples.

## Files and Responsibilities

- `policy.ts`: shared Unicode-letter eligibility rule.
- `extract.ts`: strict user-only normalization, low-information no-op, unchanged throttle/error/cache behavior for eligible input.
- `jobs.ts`: allow one eligible normalized user message and skip ineligible job creation.
- `recall.ts`: early no-op and explicit `threshold: 0.5`.
- `mem0.ts`: conservative `customInstructions`.
- Focused memory tests: reproduce the defect and lock request contracts.
- `memory-system.md`: update the project contract after implementation passes checks.

## Compatibility

- No database or Mem0 table migration.
- No change to manual preference/profile CRUD or constant injection.
- No change to seven-day project-memory expiration, cache keys, queue retry behavior, or error fallback.
- No existing memory or persisted conversation message is rewritten.
- The remaining 58 memories are not reviewed or deleted.

## Rollout and Rollback

The change is process-local application logic. Rollout requires only deploying the updated Core consumers. Rollback is a normal code revert; no data rollback is required.

After rollout, old polluted memories may still be returned for meaningful queries until they expire or are explicitly deleted. The new rules prevent the confirmed pollution path but do not retroactively sanitize existing data.

## Rejected Alternatives

- Prompt-only filtering: cannot guarantee role attribution.
- Threshold-only filtering: does not stop polluted writes and cannot protect exact or highly similar future queries.
- New memory agent, review UI, reranker, or Graphiti/Zep adoption: disproportionate to this focused boundary defect.
- Bulk cleanup of existing memories: destructive and not authorized.
