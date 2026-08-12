import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("provider timeout migration", () => {
  it("先清理历史越界值，再同步三个 CHECK、journal 和 snapshot", () => {
    const migration = readFileSync(
      join(migrationDir, "0009_massive_hellcat.sql"),
      "utf8",
    );
    const cleanupEnd = migration.lastIndexOf('SET "stream_idle_timeout_ms" = NULL');
    const constraintsStart = migration.indexOf("ADD CONSTRAINT");
    expect(cleanupEnd).toBeGreaterThanOrEqual(0);
    expect(constraintsStart).toBeGreaterThan(cleanupEnd);
    expect(migration).toContain(
      '"connect_timeout_ms" NOT BETWEEN 1000 AND 300000',
    );
    expect(migration).toContain(
      '"read_timeout_ms" NOT BETWEEN 10000 AND 3600000',
    );
    expect(migration).toContain(
      '"stream_idle_timeout_ms" NOT BETWEEN 5000 AND 900000',
    );
    expect(migration.match(/ADD CONSTRAINT "providers_.*_timeout_ms_check"/g)).toHaveLength(3);

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<Record<string, unknown>> };
    expect(journal.entries).toContainEqual({
      idx: 9,
      tag: "0009_massive_hellcat",
      version: "7",
      when: expect.any(Number),
      breakpoints: true,
    });

    const previous = JSON.parse(
      readFileSync(join(migrationDir, "meta/0008_snapshot.json"), "utf8"),
    ) as { id: string };
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0009_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        checkConstraints?: Record<string, { value: string }>;
      }>;
    };
    expect(snapshot.prevId).toBe(previous.id);
    expect(snapshot.tables["public.providers"]?.checkConstraints).toMatchObject({
      providers_connect_timeout_ms_check: {
        value: '"providers"."connect_timeout_ms" between 1000 and 300000',
      },
      providers_read_timeout_ms_check: {
        value: '"providers"."read_timeout_ms" between 10000 and 3600000',
      },
      providers_stream_idle_timeout_ms_check: {
        value: '"providers"."stream_idle_timeout_ms" between 5000 and 900000',
      },
    });
  });
});
