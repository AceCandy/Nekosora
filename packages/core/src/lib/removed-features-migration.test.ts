import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("removed template and knowledge features migration", () => {
  it("drops their schema and stale composer state with continuous metadata", () => {
    const migration = readFileSync(
      join(migrationDir, "0001_bitter_senator_kelly.sql"),
      "utf8",
    );
    expect(migration).toContain('DROP TABLE "knowledge_bases"');
    expect(migration).toContain('DROP TABLE "prompt_templates"');
    expect(migration).toContain('DROP COLUMN "knowledge_base_id"');
    expect(migration).toContain('"composer_state" - \'kbIds\'');

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toEqual({
      idx: 1,
      version: "7",
      when: expect.any(Number),
      tag: "0001_bitter_senator_kelly",
      breakpoints: true,
    });

    const baseline = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as { id: string };
    const current = JSON.parse(
      readFileSync(join(migrationDir, "meta/0001_snapshot.json"), "utf8"),
    ) as { prevId: string; tables: Record<string, { columns: Record<string, unknown> }> };
    expect(current.prevId).toBe(baseline.id);
    expect(current.tables).not.toHaveProperty("public.knowledge_bases");
    expect(current.tables).not.toHaveProperty("public.prompt_templates");
    expect(current.tables["public.file_objects"].columns).not.toHaveProperty("knowledge_base_id");
  });
});
