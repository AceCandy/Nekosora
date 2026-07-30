import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("gateway execution observability migration", () => {
  it("只破坏性替换旧日志表并同步 journal/snapshot", () => {
    const migration = readFileSync(
      join(migrationDir, "0001_adorable_dragon_lord.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "gateway_executions"');
    expect(migration).toContain('CREATE TABLE "gateway_attempts"');
    expect(migration).toContain('DROP TABLE "ops_error_logs";');
    expect(migration).toContain('DROP TABLE "usage_logs";');
    expect(migration).not.toContain("CASCADE");
    for (const protectedTable of ["runs", "tool_calls", "messages", "models", "providers", "routes", "api_keys"]) {
      expect(migration).not.toContain(`DROP TABLE "${protectedTable}"`);
    }

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual(expect.objectContaining({
      idx: 1,
      tag: "0001_adorable_dragon_lord",
    }));

    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0001_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    expect(snapshot.tables).toHaveProperty("public.gateway_executions");
    expect(snapshot.tables).toHaveProperty("public.gateway_attempts");
    expect(snapshot.tables).not.toHaveProperty("public.usage_logs");
    expect(snapshot.tables).not.toHaveProperty("public.ops_error_logs");
  });
});
