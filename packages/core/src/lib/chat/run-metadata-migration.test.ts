import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("run metadata baseline", () => {
  it("包含 nullable 的耗时与完成时间列及基线元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    expect(migration).toContain(
      '"duration_ms" integer',
    );
    expect(migration).toContain(
      '"completed_at" timestamp with time zone',
    );
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
    expect(journal.entries).toEqual(expect.arrayContaining([expect.objectContaining({
      idx: 0,
      tag: "0000_baseline",
      breakpoints: true,
    })]));

    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, { type: string; notNull: boolean }>;
      }>;
    };
    expect(currentSnapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(currentSnapshot.tables["public.runs"].columns.duration_ms).toEqual(
      expect.objectContaining({ type: "integer", notNull: false }),
    );
    expect(currentSnapshot.tables["public.runs"].columns.completed_at).toEqual(
      expect.objectContaining({ type: "timestamp with time zone", notNull: false }),
    );
  });
});
