import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("0017 run metadata migration", () => {
  it("追加 nullable 的耗时与完成时间列,并保持迁移链连续", () => {
    const migration = readFileSync(
      join(migrationDir, "0017_petite_star_brand.sql"),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER TABLE "runs" ADD COLUMN "duration_ms" integer',
    );
    expect(migration).toContain(
      'ALTER TABLE "runs" ADD COLUMN "completed_at" timestamp with time zone',
    );
    expect(migration).not.toMatch(/NOT NULL|DEFAULT/i);

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{
        idx: number;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    const currentIndex = journal.entries.findIndex(
      (entry) => entry.tag === "0017_petite_star_brand",
    );
    expect(currentIndex).toBeGreaterThan(0);
    const previousEntry = journal.entries[currentIndex - 1]!;
    const currentEntry = journal.entries[currentIndex]!;
    expect(currentEntry).toEqual(expect.objectContaining({
      idx: 17,
      tag: "0017_petite_star_brand",
      breakpoints: true,
    }));
    expect(currentEntry.when).toBeGreaterThan(previousEntry.when);

    const previousSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0016_snapshot.json"), "utf8"),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0017_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, { type: string; notNull: boolean }>;
      }>;
    };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    expect(currentSnapshot.tables["public.runs"].columns.duration_ms).toEqual(
      expect.objectContaining({ type: "integer", notNull: false }),
    );
    expect(currentSnapshot.tables["public.runs"].columns.completed_at).toEqual(
      expect.objectContaining({ type: "timestamp with time zone", notNull: false }),
    );
  });
});
