import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("0014 conversation title outbox migration", () => {
  it("追加持久标题任务表并保持迁移元数据连续", () => {
    const migration = readFileSync(
      join(migrationDir, "0014_conversation_title_outbox.sql"),
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
    const currentIndex = journal.entries.findIndex(
      (entry) => entry.idx === 14 && entry.tag === "0014_conversation_title_outbox",
    );
    expect(currentIndex).toBeGreaterThan(0);
    const previousEntry = journal.entries[currentIndex - 1];
    const currentEntry = journal.entries[currentIndex];
    expect(previousEntry.idx).toBe(13);
    expect(currentEntry).toEqual(expect.objectContaining({
      idx: 14,
      tag: "0014_conversation_title_outbox",
      breakpoints: true,
    }));
    expect(currentEntry.when).toBeGreaterThan(previousEntry.when);

    const previousSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0013_snapshot.json"), "utf8"),
    ) as { id: string };
    const currentSnapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0014_snapshot.json"), "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, {
        columns: Record<string, { type: string; notNull: boolean }>;
        indexes: Record<string, unknown>;
        uniqueConstraints: Record<string, { columns: string[] }>;
      }>;
    };
    const table = currentSnapshot.tables["public.conversation_title_jobs"];
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    expect(table.columns.dispatch_after).toEqual(expect.objectContaining({
      type: "timestamp with time zone",
      notNull: true,
    }));
    expect(table.uniqueConstraints.conversation_title_jobs_conversation_id_unique.columns)
      .toEqual(["conversation_id"]);
    expect(table.indexes).toHaveProperty("conversation_title_jobs_dispatch_idx");
  });
});
