# Implementation Plan

1. Add failing S3 tests proving `publicBaseUrl` cannot bypass presigning and public `put()` behavior remains unchanged.
2. Add failing file-route tests proving `publicReadable=true` proxies full and Range reads without calling `signedUrl`.
3. Make the minimum driver and route changes; preserve private-S3 302 and local behavior.
4. Independently review the private/public storage data flow and update the file-storage code-spec.
5. Run focused tests, lint, typecheck, full Vitest, production build, and diff checks.
6. Commit implementation, archive the task, record the journal, then continue to the next MAGI round.

## Risk And Rollback Points

- `src/lib/infra/storage/s3.ts`: dynamic AWS imports must remain function-local for Edge instrumentation builds.
- `src/app/api/files/[fileId]/route.ts`: owner validation must remain before any redirect or storage read.
- `src/lib/infra/storage/s3.test.ts` and route tests must distinguish public output URLs from private temporary access URLs.

## Completion Gate

- No private route branch returns a bare `publicBaseUrl` URL.
- Generated public-image URL behavior is covered and unchanged.
- Independent review has no blocking finding and all quality gates pass.
