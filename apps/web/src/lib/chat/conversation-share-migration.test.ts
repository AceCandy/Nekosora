import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("conversation share controls baseline", () => {
  it("包含分享配置、版本选择、限流约束与基线元数据", () => {
    const migration = readFileSync(
      join(migrationDir, "0000_baseline.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "conversation_share_unlock_attempts"');
    expect(migration).toContain('ALTER TABLE "conversation_shares" ADD COLUMN "mode" text');
    expect(migration).toContain('ALTER TABLE "conversation_shares" ADD COLUMN "expires_at" timestamp with time zone');
    expect(migration).toContain('ALTER TABLE "conversation_shares" ADD COLUMN "password_verifier" text');
    expect(migration).toContain('ALTER TABLE "conversation_shares" ADD COLUMN "render_style_snapshot" jsonb');
    expect(migration).toContain('ALTER TABLE "conversations" ADD COLUMN "message_version_selections" jsonb');
    expect(migration).toContain('ON DELETE cascade');
    expect(migration).toContain('CREATE UNIQUE INDEX "conversation_share_unlock_attempts_bucket_idx"');
    expect(migration).toContain('CREATE INDEX "conversation_shares_conversation_created_idx"');

    const journal = JSON.parse(readFileSync(join(migrationDir, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
    };
    expect(journal.entries).toEqual(expect.arrayContaining([expect.objectContaining({
      idx: 0,
      tag: "0000_baseline",
      breakpoints: true,
    })]));

    const current = JSON.parse(readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8")) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown> }>;
    };
    expect(current.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(current.tables["public.conversation_shares"].columns).toEqual(expect.objectContaining({
      mode: expect.any(Object), expires_at: expect.any(Object), password_verifier: expect.any(Object),
      render_style_snapshot: expect.any(Object),
    }));
    expect(current.tables["public.conversations"].columns).toHaveProperty("message_version_selections");
    expect(current.tables).toHaveProperty("public.conversation_share_unlock_attempts");
  });
});
