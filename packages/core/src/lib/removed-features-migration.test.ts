import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");
const compatibilityDir = join(process.cwd(), "drizzle/pg-compat");

describe("removed template and knowledge features migration", () => {
  it("keeps the baseline clean and upgrades stale pre-release data", () => {
    const migration = readFileSync(
      join(compatibilityDir, "0001_bitter_senator_kelly.sql"),
      "utf8",
    );
    expect(migration).toContain('DROP TABLE "knowledge_bases"');
    expect(migration).toContain('DROP TABLE "prompt_templates"');
    expect(migration).toContain('DROP COLUMN "knowledge_base_id"');
    expect(migration).toContain('"composer_state" - \'kbIds\'');

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toEqual([{
      idx: 0,
      version: "7",
      when: expect.any(Number),
      tag: "0000_baseline",
      breakpoints: true,
    }]);

    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { columns: Record<string, unknown> }> };
    expect(snapshot.tables).not.toHaveProperty("public.knowledge_bases");
    expect(snapshot.tables).not.toHaveProperty("public.prompt_templates");
    expect(snapshot.tables["public.file_objects"].columns).not.toHaveProperty("knowledge_base_id");
  });
});
