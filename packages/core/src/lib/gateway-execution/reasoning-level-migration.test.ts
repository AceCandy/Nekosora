import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("gateway execution reasoning level migration", () => {
  it("adds a nullable reasoning level and keeps the snapshot chain", () => {
    const migration = readFileSync(
      join(migrationDir, "0005_ambitious_moondragon.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const previous = JSON.parse(
      readFileSync(join(migrationDir, "meta/0004_snapshot.json"), "utf8"),
    ) as { id: string };
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0005_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, { type: string; notNull: boolean }> }>;
    };

    expect(migration).toContain('ADD COLUMN "reasoning_level" text');
    expect(journal.entries.find((entry) => entry.idx === 5)?.tag)
      .toBe("0005_ambitious_moondragon");
    expect(snapshot.prevId).toBe(previous.id);
    expect(snapshot.tables["public.gateway_executions"].columns.reasoning_level)
      .toMatchObject({ type: "text", notNull: false });
  });
});
