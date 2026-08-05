import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("file processing lease baseline", () => {
  it("包含可恢复文件处理租约及基线元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
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
        indexes: Record<string, { where?: string }>;
      }>;
    };
    expect(currentSnapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
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
