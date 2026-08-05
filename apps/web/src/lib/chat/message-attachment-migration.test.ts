import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("message file objects baseline", () => {
  it("声明关联约束、稳定顺序与 Drizzle 基线元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "message_file_objects"');
    expect(migration).toContain('PRIMARY KEY("message_id","file_id")');
    expect(migration).toContain('REFERENCES "public"."messages"("id") ON DELETE cascade');
    expect(migration).toContain('REFERENCES "public"."file_objects"("id") ON DELETE cascade');
    expect(migration).toContain('CREATE UNIQUE INDEX "message_file_objects_message_sort_unique_idx"');
    expect(migration).toContain('CREATE INDEX "message_file_objects_file_message_idx"');

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
    };
    expect(journal.entries).toEqual(expect.arrayContaining([expect.objectContaining({
      idx: 0,
      tag: "0000_baseline",
      breakpoints: true,
    })]));

    const current = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, unknown>;
        indexes: Record<string, unknown>;
        foreignKeys: Record<string, unknown>;
        compositePrimaryKeys: Record<string, unknown>;
      }>;
    };
    expect(current.prevId).toBe("00000000-0000-0000-0000-000000000000");
    const table = current.tables["public.message_file_objects"];
    expect(table.columns).toEqual(expect.objectContaining({
      message_id: expect.any(Object),
      file_id: expect.any(Object),
      sort_order: expect.any(Object),
    }));
    expect(table.indexes).toHaveProperty("message_file_objects_message_sort_unique_idx");
    expect(table.indexes).toHaveProperty("message_file_objects_file_message_idx");
    expect(Object.keys(table.foreignKeys)).toHaveLength(2);
    expect(table.compositePrimaryKeys).toHaveProperty("message_file_objects_message_file_pk");
  });
});
