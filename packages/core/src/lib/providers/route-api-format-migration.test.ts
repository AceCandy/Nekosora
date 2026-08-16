import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDir = join(process.cwd(), "drizzle/pg");

describe("route API format baseline", () => {
  it("contains the required route format enum and column", () => {
    const migration = readFileSync(join(migrationDir, "0000_baseline.sql"), "utf8");
    const snapshot = JSON.parse(
      readFileSync(join(migrationDir, "meta/0000_snapshot.json"), "utf8"),
    ) as {
      tables: Record<string, { columns?: Record<string, { type?: string; notNull?: boolean }> }>;
      enums: Record<string, { values?: string[] }>;
    };

    expect(migration).toContain('CREATE TYPE "public"."route_api_format"');
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
