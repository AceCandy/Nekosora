# Dependency Security

## 1. Scope / Trigger

Apply this contract when a production advisory is fixed through `pnpm.overrides` or when a transitive native dependency changes. The goal is to remove the vulnerable resolved version without silently changing unrelated dependency choices.

## 2. Signatures

Use exact overrides in the existing root `package.json` configuration:

```json
{
  "pnpm": {
    "overrides": {
      "vulnerable-package": "patched.version",
      "parent@exact.version>native-package": "verified.version"
    }
  }
}
```

Use a parent-scoped override when only one consumer requires the replacement. Do not change top-level dependency ranges unless the task explicitly requires an upgrade.

## 3. Contracts

- `package.json` is the declared override source of truth.
- `pnpm-lock.yaml` must contain the patched version and must not resolve the vulnerable version.
- `pnpm why <package>` must show the effective production dependency path.
- Native replacements must load at runtime and complete `pnpm build`.

## 4. Validation & Error Matrix

| Condition | Required response |
| --- | --- |
| Audit still reports high or critical | Trace the remaining production path; do not declare success. |
| Lockfile update changes unrelated peer versions | Restore the unrelated snapshots, then run a frozen offline install. |
| Frozen install reports a missing dependency | Restore the complete package and snapshot subtree from the previous lockfile. |
| Turbopack panics after dependency graph changes | Remove only the ignored `.next` cache and rerun a clean production build. |
| Native module cannot load or build | Roll back the override; an audit-only pass is insufficient. |

## 5. Good / Base / Bad Cases

- Good: the vulnerable version disappears, the replacement is visible through `pnpm why`, runtime loading succeeds, and the production build passes.
- Base: a patch override updates only the target package plus unavoidable peer context in the lockfile.
- Bad: `pnpm audit` is green, but an unrelated peer version drifted or the native package was never loaded and built.

## 6. Tests Required

Run and assert all of the following:

```bash
pnpm install --frozen-lockfile --offline
pnpm audit --prod --audit-level high
pnpm why <package>
node -e "require('<native-package>')"
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Inspect the lockfile diff separately; command success does not prove that unrelated peer selections stayed unchanged.

## 7. Wrong vs Correct

Wrong: run an automatic audit fix, accept a broad lockfile rewrite, and stop after the advisory disappears.

Correct: add the narrowest exact override, review the resolved dependency tree and lockfile diff, restore unrelated drift, then validate frozen installation, runtime loading, and the full production build.
