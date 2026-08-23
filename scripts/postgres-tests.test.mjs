import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("PostgreSQL integration scripts keep isolated local databases and explicit suites", () => {
  const rootManifest = JSON.parse(read("package.json"));
  const webManifest = JSON.parse(read("apps/web/package.json"));
  const coreScript = read("apps/web/scripts/test-file-processing-lease-pg.ts");

  assert.equal(
    rootManifest.scripts["test:pg"],
    "pnpm --filter @nekusora/web test:core-pg && pnpm --filter @nekusora/web test:api-key-pg",
  );
  assert.match(webManifest.scripts["test:core-pg"], /test-file-processing-lease-pg\.ts$/);
  assert.match(coreScript, /nekusora_core_pg_test_/);
  assert.match(coreScript, /\["localhost", "127\.0\.0\.1", "::1"\]/);
  for (const name of [
    "GATEWAY_GOVERNANCE_PG_TEST_DATABASE",
    "GATEWAY_RETENTION_PG_TEST_DATABASE",
    "CHAT_COMPLETION_PG_TEST_DATABASE",
    "FILE_PROCESSING_PG_TEST_DATABASE",
  ]) assert.match(coreScript, new RegExp(name));
  for (const file of [
    "gateway-governance/repository.pg.test.ts",
    "settings-control/service.pg.test.ts",
    "gateway-execution/retention.pg.test.ts",
    "chat/completion.pg.test.ts",
    "rag/process.pg.test.ts",
  ]) assert.match(coreScript, new RegExp(file.replaceAll(".", "\\.")));
  for (const file of [
    "packages/core/src/lib/gateway-governance/repository.pg.test.ts",
    "packages/core/src/lib/settings-control/service.pg.test.ts",
    "packages/core/src/lib/gateway-execution/retention.pg.test.ts",
    "packages/core/src/lib/chat/completion.pg.test.ts",
    "packages/core/src/lib/rag/process.pg.test.ts",
  ]) assert.match(read(file), /\^nekusora_core_pg_test_\[0-9a-f\]\{16\}\$/);
  assert.match(coreScript, /pg_terminate_backend/);
  assert.match(coreScript, /DROP DATABASE/);
  assert.match(coreScript, /\[REDACTED\]/);
});

test("API key migration test uses the audited historical fixture", () => {
  const script = read("apps/web/scripts/test-api-key-data-path-pg.ts");
  const baseline = read("apps/web/scripts/fixtures/api-key-data-path-pg/0000_pre_parent_removal.sql");
  const migration = read("apps/web/scripts/fixtures/api-key-data-path-pg/0001_remove_parent_id.sql");
  const journal = JSON.parse(read("apps/web/scripts/fixtures/api-key-data-path-pg/meta/_journal.json"));

  assert.match(script, /scripts\/fixtures\/api-key-data-path-pg/);
  assert.match(script, /createMigrationPrefix\(migrationsDir, 0\)/);
  assert.match(script, /\["localhost", "127\.0\.0\.1", "::1"\]/);
  assert.match(script, /pg_terminate_backend/);
  assert.match(script, /DROP DATABASE/);
  assert.match(script, /\[REDACTED\]/);
  assert.match(baseline, /"parent_id" text/);
  assert.match(baseline, /CREATE INDEX "api_keys_parent_idx"/);
  assert.equal(migration.trim(), [
    'DROP INDEX "api_keys_parent_idx";--> statement-breakpoint',
    'CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint',
    'ALTER TABLE "api_keys" DROP COLUMN "parent_id";',
  ].join("\n"));
  assert.deepEqual(
    journal.entries.map(({ idx, when, tag }) => ({ idx, when, tag })),
    [
      { idx: 0, when: 1783923353922, tag: "0000_pre_parent_removal" },
      { idx: 1, when: 1786463416426, tag: "0001_remove_parent_id" },
    ],
  );
});
