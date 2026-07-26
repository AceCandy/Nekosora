import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("0015 pending file recovery migration", () => {
  it("追加 pending 扫描部分索引并保持迁移元数据连续", () => {
    const migration = readFileSync(
      join(migrationDir, "0015_pending_file_recovery.sql"),
      "utf8",
    );
    expect(migration).toContain(
      'CREATE INDEX "file_objects_pending_processing_idx" ON "file_objects" USING btree ("created_at","id") WHERE "file_objects"."processing_status" = \'pending\'',
    );

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
    };
    const currentIndex = journal.entries.findIndex(
      (entry) => entry.idx === 15 && entry.tag === "0015_pending_file_recovery",
    );
    expect(currentIndex).toBeGreaterThan(0);
    const previousEntry = journal.entries[currentIndex - 1];
    const currentEntry = journal.entries[currentIndex];
    expect(previousEntry.idx).toBe(14);
    expect(currentEntry).toEqual(expect.objectContaining({
      idx: 15,
      tag: "0015_pending_file_recovery",
      breakpoints: true,
    }));
    expect(currentEntry.when).toBeGreaterThan(previousEntry.when);

    const previousSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0014_snapshot.json"), "utf8"),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0015_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        indexes: Record<string, {
          columns: Array<{ expression: string }>;
          where?: string;
        }>;
      }>;
    };
    const index = currentSnapshot.tables["public.file_objects"]
      .indexes.file_objects_pending_processing_idx;
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    expect(index.columns.map((column) => column.expression)).toEqual(["created_at", "id"]);
    expect(index.where).toBe('"file_objects"."processing_status" = \'pending\'');
  });
});
