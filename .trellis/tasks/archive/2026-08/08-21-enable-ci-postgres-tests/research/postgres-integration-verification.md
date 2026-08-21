# PostgreSQL Integration Verification

- The API key parent-column migration originated in `ed80cce` as
  `0011_wet_changeling.sql`. Its three statements removed
  `api_keys_parent_idx`, added `api_keys_key_prefix_idx`, and dropped
  `api_keys.parent_id`.
- The current squashed baseline already contains the post-migration shape, so the
  historical upgrade test uses a dedicated audited fixture instead of truncating the
  current journal by numeric index.
- A real `pgvector/pgvector:pg16` run executed four Core files with 30 passing tests
  and the API key file with 3 passing tests; Vitest reported no skipped tests.
- After the run, PostgreSQL reported zero databases matching the Core/API key test
  prefixes. The temporary container was stopped and removed.
- Workflow lint, all root script tests, Core/Web lint, and Core/Web typecheck passed.
  Core lint retained 12 unrelated pre-existing warnings.
