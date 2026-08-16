import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("gateway execution observability baseline", () => {
  it("creates the current execution tables without legacy log tables", () => {
    const migration = readFileSync(join(migrationDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };

    expect(migration).toContain('CREATE TABLE "gateway_executions"');
    expect(migration).toContain('CREATE TABLE "gateway_attempts"');
    expect(snapshot.tables).toHaveProperty("public.gateway_executions");
    expect(snapshot.tables).toHaveProperty("public.gateway_attempts");
    expect(snapshot.tables).not.toHaveProperty("public.usage_logs");
    expect(snapshot.tables).not.toHaveProperty("public.ops_error_logs");
  });
});
