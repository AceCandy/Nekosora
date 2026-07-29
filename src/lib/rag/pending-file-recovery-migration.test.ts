import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("pending file recovery baseline", () => {
  it("包含 pending 扫描部分索引及基线元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
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
    expect(journal.entries).toEqual([expect.objectContaining({
      idx: 0,
      tag: "0000_baseline",
      breakpoints: true,
    })]);

    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
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
    expect(currentSnapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(index.columns.map((column) => column.expression)).toEqual(["created_at", "id"]);
    expect(index.where).toBe('"file_objects"."processing_status" = \'pending\'');
  });
});
