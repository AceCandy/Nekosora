import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "drizzle", "pg");

describe("API key data path PostgreSQL baseline", () => {
  it("keeps only the prefix index and no parent relation", () => {
    const sql = readFileSync(join(migrationsDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "0000_snapshot.json"), "utf8"),
    );
    const apiKeys = snapshot.tables["public.api_keys"];

    expect(sql).toContain('CREATE INDEX "api_keys_key_prefix_idx"');
    expect(apiKeys.columns.parent_id).toBeUndefined();
    expect(apiKeys.indexes.api_keys_parent_idx).toBeUndefined();
    expect(apiKeys.indexes.api_keys_key_prefix_idx).toBeDefined();
  });
});
