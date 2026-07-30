# Model Catalog Sync Evidence

## Repository Baseline

- Branch `dev_0729`; planning began with a clean worktree and no active implementation task.
- Current sync defects:
  - `src/lib/sync-pi-models.ts:310-313` casts external `thinkingLevelMap`.
  - `src/lib/sync-pi-models.ts:326-333` only upgrades reasoning/vision/effort.
  - `src/lib/sync-pi-models.ts:645-650` falls back only the map.
  - `scripts/sync-pi-models.ts:93-115` duplicates translate/fallback for SQL.
  - `scripts/sync-pi-models.ts:274-277` applies statements sequentially outside the migration path.
- Runtime chain:
  - `src/lib/reasoning.ts:18-31` derives supported levels from catalog.
  - `src/lib/reasoning.ts:38-64` clamps and restores state by model ID.
  - `src/lib/reasoning.ts:74-123` translates compatible request bodies.
  - `src/lib/reasoning.ts:153-207` translates native provider options.
- Migration chain contains `0000_baseline`, `0001_adorable_dragon_lord`, `0002_wet_hellcat`; next data migration must append idx 3 and a successor snapshot.

## Live Pi Payload (2026-07-30)

- Source: public `https://pi.dev/api/models`.
- 37 providers, 1153 models; 897 reasoning=true; 339 maps.
- Every current row explicitly includes boolean reasoning and array input, but decoder design retains missing as unknown for future payloads.
- `compat.thinkingFormat` counts: openrouter 303, deepseek 43, qwen 27, together 14, zai 12, openai 4, ant-ling 3.
- `compat.supportsReasoningEffort` appears on 99 rows: 7 true and 92 false. False must not collapse to missing.
- Map values include `null`, lowercase/uppercase supplier values, `none`, `default`, and other non-empty strings. Keys remain the seven project levels; value validation must not treat supplier strings as the level enum.
- Seven current upstream rows report reasoning=false while still carrying a map. A disabled reasoning bundle must therefore normalize away irrelevant thinking fields rather than mixing them into catalog state.
- Local DB dry-run: 510 chat rows, 498 matched, 12 unmatched. Legacy planner proposed only two OpenRouter context/max changes; both are reference-source facts and should not write.

## Official Facts For Current Downgrades

### GLM-5.2

- Official model page: `https://docs.z.ai/guides/llm/glm-5.2`.
- It states input modality Text and output modality Text; vision models are separate.
- Examples use `thinking.type` enabled and `reasoning_effort: max`.
- Official thinking page confirms the model reasons by default and accepts `thinking.type: disabled`.
- Conclusion: remove erroneous vision capability; retain reasoning format/effort. The full supported effort level set is not stated by the page, so pi map remains reference data rather than independent official proof.

### Kimi K2

- Official source repository: `MoonshotAI/Kimi-K2`, README `Model Variants`.
- Kimi-K2-Instruct is described as a reflex-grade model without long thinking.
- Current catalog row `kimi-k2` aliases the 0711 preview and incorrectly has reasoning=true with `thinkingFormat: deepseek`.
- Conclusion: disable reasoning and delete the related thinking bundle. Newer K2.6/K2.7/K3 thinking behavior is a different model family and must not be projected backward.

## Current Data Impact

- Structural direct-match scan finds two official-confirmed downgrades:
  - one vision true -> unsupported;
  - one reasoning true -> unsupported.
- Current catalog contains no empty-string map values and no row failing the existing invariant gate.
- No schema change or data clearing is required. `models.catalog_id` uses `ON DELETE RESTRICT`, so catalog deletion would be both unnecessary and unsafe.

## Existing Test Gaps

- No unknown map key/value, compat false, missing-vs-false, atomic fallback, authority or deterministic plan tests.
- Existing tests explicitly lock the old only-upgrade behavior and must be replaced.
- No script-level CLI tests; no proof that dry-run and SQL use one plan.
- SQL tests currently check string fragments, not repeated execution or unrelated JSON preservation.
- Consumer pure tests exist in `src/lib/reasoning.test.ts`; migration metadata tests exist in `src/lib/model-catalog.test.ts`.

## Planning Decision

- Remove bulk import and direct apply from this tool. Mainstream model additions remain explicit catalog migrations backed by official facts.
- Keep pi as compatibility/reference input, with writes limited to direct evidence plus official review.
- Generate one forward data migration; do not clear catalog or conversation state.

## Implementation Outcome (2026-07-30)

- The pure planner now owns decode, match evidence, authority, atomic reasoning normalization, deterministic audit output, and SQL operations. The CLI only loads sources/rows, renders the plan, and writes migration artifacts.
- Final reviewed snapshot dry-run is deterministic across repeated runs: `matched=498`, `unchanged=466`, `accepted=2`, `references=30`, `rejected=88`, `unmatched=12`.
- Accepted changes remain limited to `glm-5.2` vision removal and the four-key `kimi-k2` reasoning bundle removal. Isolated thinking metadata on rows without enabled reasoning is audited with `reasoning_disabled_extras_ignored` and preserved.
- `0003_model_catalog_sync` contains two targeted JSONB updates, a source SHA-256, an append-only journal entry, and a schema-identical successor snapshot.
- An isolated random PostgreSQL database applied `0000..0003`; catalog row count stayed `517`, the one foreign key referencing `model_catalog` stayed unchanged, unrelated target-row data stayed unchanged, and a second `0003` execution preserved capabilities and `updated_at`. The database was removed afterward.
- Final focused tests passed `103/103`; lint and typecheck passed; the full suite passed with one worker (`954 passed`, `17 skipped`); production build passed. The default parallel full-suite command twice hit unrelated five-second import timeouts under shared host load, while all affected files passed with one worker.
- The local pi snapshot and migration temporary files were removed; no cache, direct apply, schema change, table clear, or persistent test database was introduced.
