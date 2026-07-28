import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("0018 message file objects migration", () => {
  it("声明关联约束、稳定顺序与连续 Drizzle 元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0018_message_file_objects.sql"),
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
    const index = journal.entries.findIndex((entry) => entry.tag === "0018_message_file_objects");
    expect(index).toBeGreaterThan(0);
    expect(journal.entries[index]).toEqual(expect.objectContaining({ idx: 18, breakpoints: true }));
    expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);

    const previous = JSON.parse(
      readFileSync(join(migrationDir, "meta/0017_snapshot.json"), "utf8"),
    ) as { id: string };
    const current = JSON.parse(
      readFileSync(join(migrationDir, "meta/0018_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, unknown>;
        indexes: Record<string, unknown>;
        foreignKeys: Record<string, unknown>;
        compositePrimaryKeys: Record<string, unknown>;
      }>;
    };
    expect(current.prevId).toBe(previous.id);
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
