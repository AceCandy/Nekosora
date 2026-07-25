# Verification Evidence

## Before Startup

- `0009_lethal_killmonger` hash `e4d04b5e...` was recorded at old time `1784960819328`.
- Current `0008` was recorded at `1784985600000`.
- `0010_lazy_gorgon` had no ledger row.
- `conversation_shares.message_snapshots_json` did not exist.

## Startup Result

- Development server became ready on port `3108`.
- Bootstrap logged one reconciliation: `1784960819328 -> 1784988074784`.
- Official Drizzle migration completed without replaying `0009`.
- `/healthz` returned `status=ok`.
- `/healthz/ready` returned `status=ready` with database, storage, queue, and Redis checks healthy.
- The debug server was stopped; port `3108` and its process list were empty afterward.

## After Startup

- Ledger id `43` retained the `0009` hash and now has `created_at=1784988074784`.
- Ledger id `45` contains the exact `0010` hash at `1785003843594`.
- `conversation_shares.message_snapshots_json` exists as nullable `jsonb`.

## Automated Gates

- Focused migration tests: 24 passed.
- Full test suite: 61 files, 571 tests passed.
- `pnpm lint`: passed with no warnings or errors.
- `pnpm typecheck`: passed.
- `pnpm build`: passed, including Edge instrumentation compilation.
- `git diff --check`: passed.
