# Reasoning Migration Audit

- Reviewed source: `https://pi.dev/api/models`
- Snapshot SHA-256: `4c3693760c234130739781dfdc4adc0eb77d3a8b0215bd54d63b8aa035604752`
- Invalid baseline rows: 271
- Repaired from explicit official/native evidence: 51
  - OpenAI: 26
  - Anthropic: 5
  - Anthropic adaptive: 5
  - Google: 15
- Downgraded because no authoritative format evidence was available: 220

`drizzle/pg/0002_model_catalog_reasoning.sql` contains the exact 51 repaired IDs and
220 downgraded IDs. The immutable `0000_baseline.sql` catalog JSON is the
deterministic source for every pre-migration reasoning bundle, so a rollback
migration can restore only those listed IDs without relying on live database
state.

PostgreSQL verification applied `0000`, `0001`, and `0002` in `pgvector:pg16`:

- invalid reasoning rows: 271 -> 0
- unrelated capability changes: 0
- second `0002` execution: 0 + 0 updated rows
