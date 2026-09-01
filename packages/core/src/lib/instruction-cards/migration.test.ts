import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");
const compatibilityDir = join(process.cwd(), "drizzle/pg-compat");

describe("instruction cards ownership migration", () => {
  it("removes global scopes and requires a user owner", () => {
    const migration = readFileSync(
      join(compatibilityDir, "0004_typical_photon.sql"),
      "utf8",
    );
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, {
        columns: Record<string, { notNull?: boolean }>;
        indexes: Record<string, unknown>;
      }>;
    };

    const deleteOwnerless = 'DELETE FROM "instruction_cards" WHERE "user_id" IS NULL';
    const requireOwner = 'ALTER COLUMN "user_id" SET NOT NULL';
    expect(migration).toContain(deleteOwnerless);
    expect(migration).toContain('ALTER COLUMN "user_id" SET NOT NULL');
    expect(migration).toContain('DROP COLUMN "scope"');
    expect(migration.indexOf(deleteOwnerless)).toBeLessThan(migration.indexOf(requireOwner));

    const table = snapshot.tables["public.instruction_cards"];
    expect(table.columns.user_id.notNull).toBe(true);
    expect(table.columns).not.toHaveProperty("scope");
    expect(table.indexes).not.toHaveProperty("instruction_cards_scope_idx");
  });
});
