import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("gateway execution reasoning level migration", () => {
  it("keeps a nullable reasoning level in the root baseline", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, { columns: Record<string, { type: string; notNull: boolean }> }>;
    };

    expect(migration).toContain('"reasoning_level" text');
    expect(journal.entries).toEqual([expect.objectContaining({ idx: 0, tag: "0000_baseline" })]);
    expect(snapshot.tables["public.gateway_executions"].columns.reasoning_level)
      .toMatchObject({ type: "text", notNull: false });
  });
});
