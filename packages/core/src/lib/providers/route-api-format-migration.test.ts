import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("route api format migration", () => {
  it("按 Provider 协议回填并同步 journal/snapshot", () => {
    const migration = readFileSync(join(migrationDir, "0007_modern_harrier.sql"), "utf8");
    expect(migration).toContain('CREATE TYPE "public"."route_api_format"');
    expect(migration).toContain('ALTER TABLE "routes" ADD COLUMN "api_format" "route_api_format";');
    expect(migration).toContain('FROM "providers" AS p');
    for (const [protocol, format] of [
      ["openai", "openai-chat"],
      ["openai-compatible", "openai-chat"],
      ["anthropic", "anthropic-messages"],
      ["gemini", "gemini-generate-content"],
      ["openai-images", "openai-images"],
      ["openai-audio-stt", "openai-audio-stt"],
      ["openai-audio-tts", "openai-audio-tts"],
    ]) {
      expect(migration).toContain(`WHEN '${protocol}' THEN '${format}'`);
    }
    expect(migration).toContain('ALTER TABLE "routes" ALTER COLUMN "api_format" SET NOT NULL;');

    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual({
      idx: 7,
      tag: "0007_modern_harrier",
      version: "7",
      when: expect.any(Number),
      breakpoints: true,
    });

    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0007_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, { columns?: Record<string, { type?: string; notNull?: boolean }> }>;
      enums: Record<string, { values?: string[] }>;
    };
    expect(snapshot.tables["public.routes"]?.columns?.api_format).toMatchObject({
      type: "route_api_format",
      notNull: true,
    });
    expect(snapshot.enums["public.route_api_format"]?.values).toEqual([
      "openai-chat",
      "openai-responses",
      "anthropic-messages",
      "gemini-generate-content",
      "openai-images",
      "openai-audio-stt",
      "openai-audio-tts",
    ]);
  });
});
