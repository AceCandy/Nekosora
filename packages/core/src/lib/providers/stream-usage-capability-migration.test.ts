import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("provider stream usage capability baseline", () => {
  it("keeps the nullable provider capability in SQL and snapshot", () => {
    const migration = readFileSync(join(migrationDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { columns?: Record<string, unknown> }> };

    expect(migration).toContain('"supports_stream_usage" boolean');
    expect(snapshot.tables["public.providers"]?.columns?.supports_stream_usage).toMatchObject({
      type: "boolean",
      notNull: false,
    });
  });
});
