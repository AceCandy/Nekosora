# Bug Analysis: Drizzle migration journal retiming blocked startup

## 1. Root Cause Category

- **Category**: C - Change Propagation Failure; E - Implicit Assumption; D - Test Coverage Gap
- **Specific Cause**: An already published journal entry was renumbered and retimed while deployed databases retained the original `created_at`. Drizzle PostgreSQL migration compares only the latest ledger timestamp with journal `folderMillis`, so it treated the already executed SQL as new and retried `CREATE TABLE message_feedback`.
- **Evidence**: The database stored the exact current `0009` SQL hash at `1784960819328`, while the current journal assigned that hash to `1784988074784`; `message_feedback` existed and `0010` had not run. Confidence is above 99% because the failure was reproduced and the corrected startup applied only the expected ledger retiming plus `0010`.

## 2. Why Fixes Failed

1. The journal cleanup fixed repository numbering but did not account for persisted migration ledgers in existing databases.
2. The first reconciliation implementation accepted any baseline hash and performed validation and UPDATE without one locked transaction, leaving fail-open and concurrency gaps.
3. Unit tests covered schema adoption but not published-journal immutability, same-hash retiming, multi-process startup, or real database migration state.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Documentation | Declare published SQL and journal entries immutable in the database code-spec | DONE |
| P0 | Architecture | Serialize startup migration on one dedicated connection with an advisory lock | DONE |
| P0 | Runtime | Reconcile only a provable continuous prefix and fail closed on every ambiguity | DONE |
| P0 | Test Coverage | Cover drift, rejection matrix, lock lifecycle, full tests, build, and real startup | DONE |
| P1 | Code Review | Require migration diffs to prove old entries were not rewritten | DONE |

## 4. Systematic Expansion

- **Similar Issues**: Any environment that executed a migration before a journal rename, timestamp rewrite, squash, or SQL edit can diverge from repository metadata.
- **Design Improvement**: Treat the database ledger and committed migration artifacts as one append-only contract; process concurrency must be serialized on the same physical connection used by the migrator.
- **Process Improvement**: Review migration changes against Git history and deployed ledger semantics, not only the current file tree. Always add a new migration for follow-up changes.
- **Residual Risk**: The legacy baseline adoption mechanism validates required table/type names rather than every column, constraint, and index. This pre-existing behavior remains outside this task.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/backend/database-guidelines.md` with executable migration contracts.
- [x] Added unit coverage for reconciliation, rejection cases, and connection lifecycle.
- [x] Recorded real database before/after verification for the task.
- [x] Confirmed no repository-owned spec template copy exists to synchronize.
