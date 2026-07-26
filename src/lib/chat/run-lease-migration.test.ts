import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("0012 run lease migration", () => {
  it("追加租约 schema、滚动升级数据兼容与连续元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0012_add_run_lease.sql"),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER TABLE "runs" ADD COLUMN "lease_expires_at" timestamp with time zone',
    );
    expect(migration).toMatch(
      /UPDATE "runs"[\s\S]*"lease_expires_at" = now\(\) \+ interval '2 minutes'[\s\S]*WHERE "status" = 'running'/,
    );
    expect(migration).toContain(
      'ALTER TABLE "runs" ALTER COLUMN "lease_expires_at" SET DEFAULT now() + interval \'2 minutes\'',
    );
    expect(migration).not.toContain('UPDATE "conversations"');
    expect(migration).toContain(
      'CREATE INDEX "runs_active_conversation_idx" ON "runs" USING btree ("conversation_id","lease_expires_at") WHERE "runs"."status" = \'running\'',
    );

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{
        idx: number;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    const previousEntry = journal.entries.at(-2)!;
    const currentEntry = journal.entries.at(-1)!;
    expect(currentEntry).toEqual(expect.objectContaining({
      idx: 12,
      tag: "0012_add_run_lease",
      breakpoints: true,
    }));
    expect(currentEntry.when).toBeGreaterThan(previousEntry.when);

    const previousSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0011_snapshot.json"), "utf8"),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0012_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, { type: string; notNull: boolean; default?: string }>;
        indexes: Record<string, { where?: string }>;
      }>;
    };
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    expect(currentSnapshot.tables["public.runs"].columns.lease_expires_at)
      .toEqual(expect.objectContaining({
        type: "timestamp with time zone",
        notNull: false,
        default: "now() + interval '2 minutes'",
      }));
    expect(currentSnapshot.tables["public.runs"].indexes.runs_active_conversation_idx)
      .toEqual(expect.objectContaining({ where: '"runs"."status" = \'running\'' }));
  });
});
