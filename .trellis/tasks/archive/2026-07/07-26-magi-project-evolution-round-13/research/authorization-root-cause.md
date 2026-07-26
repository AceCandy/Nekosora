# Bug Analysis: Client Resource IDs Bypassed Provider Ownership

## 1. Root Cause Category

- **Category**: C - Change Propagation Failure, with D - Test Coverage Gap and E - Implicit Assumption.
- **Specific Cause**: The unified resource model defined Providers as owner-only, but that rule was propagated to list and CRUD actions inconsistently. Owner-filtered UI options were implicitly treated as authorization even though Server Action `FormData` and IDs can be forged.

## 2. Why Earlier Protection Was Incomplete

1. `attachProviderModelRoute` used `providerId + ownerUserId`, but the same predicate was not reused by `createModel`, `createRoute`, or `updateRoute`.
2. `testRoute` authenticated an admin but did not authorize the submitted route before decrypting the referenced Provider key and probing upstream.
3. Existing tests covered only the correctly implemented attach action, so the asymmetric entry points remained invisible.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Reuse one owner-scoped Provider resolver across all model/route actions in the same module. | DONE |
| P0 | Test coverage | Exercise every Provider association entry point with owned and foreign IDs; assert failures occur before side effects. | DONE |
| P0 | Documentation | Add the executable authorization contract to `backend/gateway-routing.md`. | DONE |
| P1 | Review checklist | Add client resource ID authorization checks to the cross-layer thinking guide. | DONE |
| P1 | Systematic expansion | Fix and test the independent Embedding settings Provider-ID boundary. | NEXT ROUND |

## 4. Systematic Expansion

- **Similar Issues**: `admin/settings/ModelConfigSection.tsx:107-115` stores a client-supplied Embedding Provider ID without an owner predicate; `rag/embedding.ts:57-72` later reads and decrypts it globally.
- **Design Improvement**: After the settings boundary is fixed, reassess whether Provider ownership resolution should move from a file-local helper to a shared server-only module. Do not extract it before a second production consumer exists.
- **Process Improvement**: When a resource ownership rule changes, inventory every client-supplied ID consumer, not only list queries and the entry point that exposed the original bug.

## 5. Knowledge Capture

- [x] Gateway Routing spec updated with association-time authorization and tests.
- [x] Cross-layer guide updated with resource-ID authorization checks.
- [x] Embedding settings vulnerability recorded as the next P1 candidate.
- [ ] Next round adds the Embedding regression and owner-scoped write validation.
