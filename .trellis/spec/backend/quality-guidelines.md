# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

Run from the repository root:

```bash
pnpm check  # quality:workspace + lint + typecheck
pnpm test   # Node script tests + workspace Vitest suites
```

`scripts/workspace-quality.mjs` declares required scripts and explicit no-test
exceptions. Do not treat recursive `--if-present` alone as complete coverage.
Build, real PostgreSQL, and container gates remain defined in
[CI And Container Publishing](./ci-container-publishing.md).

---

## Forbidden Patterns

- Do not exclude existing `*.test.ts` / `*.test.tsx` files from TypeScript checking.
- Do not silence fixture errors with new `any`, `as never`, `@ts-ignore`, or relaxed
  compiler settings. Keep invalid-input tests explicit and preserve their assertions.
- Do not increase ESLint's warning allowance or add no-op scripts to satisfy coverage.

---

## Required Patterns

- All five existing lint scripts use `--max-warnings 0`; warnings fail the gate.
- Test code is checked by each package's existing `tsc --noEmit` configuration.
  Vitest execution does not replace type checking; type checking does not execute tests.
- Use actual function signatures for mocks, for example
  `vi.fn<GatewayTelemetryPort["recordAttempt"]>()`. For generic return types, preserve
  the contract on the mock object and spy on its method instead of erasing the generic.
- Keep TypeScript and Vitest aliases aligned. Database consumers use the existing
  `@nekusora/db`, `@nekusora/db/types`, and `@nekusora/db/schema` exports;
  do not restore consumer aliases into database source files. Keep type-only
  imports erased and mock the public schema path in factory tests. Verify
  resolver changes with typecheck, tests, and application builds.

---

## Testing Requirements

- Keep Vitest tests beside the implementation under `src/`; use the package's actual
  include patterns. Root script tests use `scripts/*.test.mjs` and Node's test runner.
- Cover changed routing, stream terminal/cancellation, authorization, retry, and
  persistence contracts in proportion to risk. Reuse existing fixtures and frameworks.
- Narrow JSON assertion inputs with concrete shapes or matchers; check actual values,
  not just property existence. Keep error-code, status, ordering, and privacy assertions.
- Normal `pnpm test` may skip explicitly isolated PostgreSQL suites. Only a successful
  `pnpm test:pg` run proves those database paths; report skipped tests separately.

---

## Code Review Checklist

- [ ] `pnpm check` passes without warnings; `pnpm test` passes.
- [ ] New/existing tests remain in the relevant TypeScript and Vitest file sets.
- [ ] Fixture signatures match production contracts; no assertions were weakened.
- [ ] Package aliases and ownership agree with the directory guide.
- [ ] An independent diff review checked scope, privacy, and unintended runtime changes.
- [ ] Build, browser, external-service, and real-database checks not run are stated explicitly.
