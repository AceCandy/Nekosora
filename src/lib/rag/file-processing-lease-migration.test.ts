import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("0013 file processing lease migration", () => {
  it("追加可恢复文件处理租约并保持迁移元数据连续", () => {
    const migration = readFileSync(
      join(migrationDir, "0013_add_file_processing_lease.sql"),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER TABLE "file_objects" ADD COLUMN "processing_lease_id" text',
    );
    expect(migration).toContain(
      'ALTER TABLE "file_objects" ADD COLUMN "processing_lease_expires_at" timestamp with time zone',
    );
    expect(migration).toMatch(
      /UPDATE "file_objects"[\s\S]*"processing_lease_expires_at" = now\(\)[\s\S]*"processing_status" IN \('extracting', 'embedding'\)[\s\S]*"processing_lease_expires_at" IS NULL/,
    );
    expect(migration).toContain(
      'CREATE INDEX "file_objects_stale_processing_idx" ON "file_objects" USING btree ("processing_lease_expires_at","created_at") WHERE "file_objects"."processing_status" IN (\'extracting\', \'embedding\')',
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
    const previousEntry = journal.entries.at(-2)!;
    const currentEntry = journal.entries.at(-1)!;
    expect(currentEntry).toEqual(expect.objectContaining({
      idx: 13,
      tag: "0013_add_file_processing_lease",
      breakpoints: true,
    }));
    expect(currentEntry.when).toBeGreaterThan(previousEntry.when);

    const previousSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0012_snapshot.json"), "utf8"),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0013_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, { type: string; notNull: boolean }>;
        indexes: Record<string, { where?: string }>;
      }>;
    };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    expect(currentSnapshot.tables["public.file_objects"].columns.processing_lease_id)
      .toEqual(expect.objectContaining({ type: "text", notNull: false }));
    expect(currentSnapshot.tables["public.file_objects"].columns.processing_lease_expires_at)
      .toEqual(expect.objectContaining({
        type: "timestamp with time zone",
        notNull: false,
      }));
    expect(
      currentSnapshot.tables["public.file_objects"].indexes.file_objects_stale_processing_idx,
    ).toEqual(expect.objectContaining({
      where: '"file_objects"."processing_status" IN (\'extracting\', \'embedding\')',
    }));
  });
});
