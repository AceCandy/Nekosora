import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("conversation title outbox baseline", () => {
  it("包含持久标题任务表和基线元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "conversation_title_jobs"');
    expect(migration).toContain('"id" text PRIMARY KEY NOT NULL');
    expect(migration).toContain('"conversation_id" text NOT NULL');
    expect(migration).toContain('"user_id" text NOT NULL');
    expect(migration).toContain('"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL');
    expect(migration).toContain(
      'CONSTRAINT "conversation_title_jobs_conversation_id_unique" UNIQUE("conversation_id")',
    );
    expect(migration).toContain(
      'CONSTRAINT "conversation_title_jobs_conversation_id_conversations_id_fk"',
    );
    expect(migration).toContain(
      'CONSTRAINT "conversation_title_jobs_user_id_user_id_fk"',
    );
    expect(migration).toContain(
      'CREATE INDEX "conversation_title_jobs_dispatch_idx" ON "conversation_title_jobs" USING btree ("dispatch_after","created_at")',
    );

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as {
      entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
    };
    expect(journal.entries).toEqual(expect.arrayContaining([expect.objectContaining({
      idx: 0,
      tag: "0000_baseline",
      breakpoints: true,
    })]));

    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, { type: string; notNull: boolean }>;
        indexes: Record<string, unknown>;
        uniqueConstraints: Record<string, { columns: string[] }>;
      }>;
    };
    const table = currentSnapshot.tables["public.conversation_title_jobs"];
    expect(currentSnapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(table.columns.dispatch_after).toEqual(expect.objectContaining({
      type: "timestamp with time zone",
      notNull: true,
    }));
    expect(table.uniqueConstraints.conversation_title_jobs_conversation_id_unique.columns)
      .toEqual(["conversation_id"]);
    expect(table.indexes).toHaveProperty("conversation_title_jobs_dispatch_idx");
  });
});
