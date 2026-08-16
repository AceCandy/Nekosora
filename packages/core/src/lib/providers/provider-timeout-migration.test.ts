import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("provider timeout baseline", () => {
  it("contains all timeout checks in SQL and snapshot", () => {
    const migration = readFileSync(join(migrationDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { checkConstraints?: Record<string, { value: string }> }> };

    expect(migration.match(/CONSTRAINT "providers_.*_timeout_ms_check" CHECK/g)).toHaveLength(3);
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
