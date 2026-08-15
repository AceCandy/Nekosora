# Memory Boundary Practices

## Scope

Research current official guidance and implementations for deciding what becomes long-term conversational memory, with emphasis on preventing assistant-generated text from being misattributed as durable user intent.

## Findings

### Mem0

- Mem0 recommends calling `add` only after a useful interaction and only for information worth reusing later: preferences, decisions, account facts, goals, and durable feedback.
- The application decides which search results enter the model prompt.
- Mem0 separates conversation, session, user, and organization memory. `run_id` is intended for short-lived session context; `user_id` is intended for lasting personalization.
- Search should always be scoped with identifiers or metadata. `top_k` and `threshold` should be tuned for the product; the official documentation does not prescribe a universal threshold.
- `add` accepts both user and assistant turns and the current algorithm treats agent-generated facts as first-class. Therefore Mem0 itself does not provide the required hard boundary between assistant output and user intent.

Official sources:

- [How Mem0 Works](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx)
- [Memory Types](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-types.mdx)
- [Add Memory](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-operations/add.mdx)
- [Search Memory](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-operations/search.mdx)
- [Mem0 README](https://github.com/mem0ai/mem0#new-memory-algorithm-april-2026)

### LangMem and LangGraph

- The hot-path pattern exposes explicit memory-management and search tools to the agent.
- The background pattern uses a separate memory manager to extract and consolidate durable facts after the response.
- Long-term stores are separated from per-thread checkpoints, and namespaces can isolate user, assistant, and organization memory.
- Background processing can be delayed or debounced instead of running indiscriminately on every message.

Official sources:

- [Hot-path quickstart](https://github.com/langchain-ai/langmem/blob/main/docs/docs/hot_path_quickstart.md)
- [Background quickstart](https://github.com/langchain-ai/langmem/blob/main/docs/docs/background_quickstart.md)

### Letta

- Long-term memory changes are explicit tool operations such as append, replace, or patch.
- Its background Sleeptime agent is told that `assistant` messages come from the primary agent and `user` messages come from the primary agent's user.
- The memory prompt says not every observation warrants an edit and allows the worker to finish without writing when there is no meaningful update.

Official sources:

- [Sleeptime agent](https://github.com/letta-ai/letta/blob/main/letta/groups/sleeptime_multi_agent_v4.py)
- [Sleeptime memory prompt](https://github.com/letta-ai/letta/blob/main/letta/prompts/system_prompts/sleeptime_v2.py)
- [Memory tools](https://github.com/letta-ai/letta/blob/main/letta/constants.py)

### Graphiti and Zep

- Graphiti preserves the episode that produced a fact, records temporal validity, and invalidates superseded facts instead of endlessly appending an unqualified current truth.
- These capabilities are useful for evolving enterprise knowledge, but adopting a temporal graph would add storage and operational complexity that is unnecessary for this defect.

Official source:

- [Graphiti README](https://github.com/getzep/graphiti/blob/main/README.md)

## Common Practices

1. Separate conversation/session context from cross-conversation user memory.
2. Treat long-term memory writes as selective, controlled operations rather than a side effect of every completed response.
3. Preserve role and provenance; assistant output is not evidence of user intent.
4. Promote an assistant suggestion only after the user explicitly confirms it.
5. Scope retrieval by user and relevant metadata, then apply a relevance cutoff and small result limit.
6. Keep deletion, expiry, and correction available because extraction remains probabilistic.

## Recommendation for This Task

- Keep the existing background extraction architecture; no new dependency or memory service is needed.
- Apply a deterministic low-information gate before both extraction and recall.
- Send only user-authored messages to automatic project-memory extraction. A later user confirmation is eligible through that user-authored confirmation; assistant text is never independently promoted.
- Add conservative Mem0 custom instructions as a second, probabilistic filter, not as the enforcement boundary.
- Keep `topK: 5` and pass an explicit threshold. Treat the selected value as an initial product setting covered by tests, not as an industry-standard constant.
- Do not introduce Graphiti, a separate memory agent, a review UI, or new provenance schema for this focused repair.

## Threshold Note

The external projects agree on filtering and evaluation but do not publish one universal similarity threshold. For the current Mem0 configuration, `0.5` is the balanced initial option: it is materially stricter than the current `0.1` default while carrying less false-negative risk than `0.7`. The choice still requires product approval and should later be calibrated against representative recall examples if memory quality becomes a measured feature.
