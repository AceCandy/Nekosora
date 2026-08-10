import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("provider stream usage capability migration", () => {
  it("同步生成 nullable Provider 字段、journal 和 snapshot", () => {
    const migration = readFileSync(join(migrationDir, "0008_amused_vengeance.sql"), "utf8");
    expect(migration.trim()).toBe(
      'ALTER TABLE "providers" ADD COLUMN "supports_stream_usage" boolean;',
    );

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<Record<string, unknown>> };
    expect(journal.entries).toContainEqual({
      idx: 8,
      tag: "0008_amused_vengeance",
      version: "7",
      when: expect.any(Number),
      breakpoints: true,
    });

    const previous = JSON.parse(
      readFileSync(join(migrationDir, "meta/0007_snapshot.json"), "utf8"),
    ) as { id: string };
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0008_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, { columns?: Record<string, unknown> }>;
    };
    expect(snapshot.prevId).toBe(previous.id);
    expect(snapshot.tables["public.providers"]?.columns?.supports_stream_usage).toMatchObject({
      type: "boolean",
      notNull: false,
    });
  });
});
