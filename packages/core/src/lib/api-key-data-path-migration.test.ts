import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "drizzle", "pg");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((name) => /^0011_.*\.sql$/.test(name))
  : [];

describe("API key data path PostgreSQL migration", () => {
  it("adds the prefix index and removes the unused parent relation", () => {
    expect(migrationFiles).toHaveLength(1);
    const sql = readFileSync(join(migrationsDir, migrationFiles[0]), "utf8");

    expect(sql.split("--> statement-breakpoint").map((statement) => statement.trim())).toEqual([
      'DROP INDEX "api_keys_parent_idx";',
      'CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");',
      'ALTER TABLE "api_keys" DROP COLUMN "parent_id";',
    ]);
  });

  it("keeps journal and snapshot continuity", () => {
    expect(migrationFiles).toHaveLength(1);
    const tag = migrationFiles[0].replace(/\.sql$/, "");
    const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
    const entry = journal.entries.find((candidate: { tag?: string }) => candidate.tag === tag);
    expect(entry).toMatchObject({
      idx: 11,
      version: "7",
      tag,
      breakpoints: true,
    });

    const previous = JSON.parse(readFileSync(join(migrationsDir, "meta", "0010_snapshot.json"), "utf8"));
    const currentPath = join(migrationsDir, "meta", "0011_snapshot.json");
    expect(existsSync(currentPath)).toBe(true);
    const current = JSON.parse(readFileSync(currentPath, "utf8"));
    expect(current.prevId).toBe(previous.id);
    const apiKeys = current.tables["public.api_keys"];
    expect(apiKeys.columns.parent_id).toBeUndefined();
    expect(apiKeys.indexes.api_keys_parent_idx).toBeUndefined();
    expect(apiKeys.indexes.api_keys_key_prefix_idx).toBeDefined();
  });
});
