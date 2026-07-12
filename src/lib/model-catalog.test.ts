import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findCatalogMatch, normalizeCatalogModelId } from "@/lib/model-catalog";

const entries = [
  {
    id: "glm",
    canonicalModelId: "glm-5.2",
    aliases: ["zai/glm-5.2", "volcengine/glm-5.2"],
  },
  {
    id: "generic",
    canonicalModelId: "__generic_chat__",
    aliases: [],
  },
];

describe("model catalog matching", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeCatalogModelId("  GLM-5.2 ")).toBe("glm-5.2");
  });

  it("matches canonical ids and explicit aliases only", () => {
    expect(findCatalogMatch(entries, "GLM-5.2")?.id).toBe("glm");
    expect(findCatalogMatch(entries, "zai/glm-5.2")?.id).toBe("glm");
    expect(findCatalogMatch(entries, "other/glm-5.2")).toBeNull();
  });

  it("does not use generic templates as automatic matches", () => {
    expect(findCatalogMatch(entries, "__generic_chat__")).toBeNull();
  });
});

describe("current mainstream catalog seed", () => {
  const pgSeed = readFileSync("drizzle/pg/0016_current_model_catalog.sql", "utf8");
  const pgThinkingPatch = readFileSync("drizzle/pg/0017_gemini_thinking_levels.sql", "utf8");
  const pgEffortPatch = readFileSync("drizzle/pg/0018_reasoning_effort_support.sql", "utf8");
  const pgAgnesCatalog = readFileSync("drizzle/pg/0019_agnes_flash_models.sql", "utf8");
  const requiredModels = [
    "claude-sonnet-5",
    "claude-opus-4-8",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gpt-5.5",
    "gpt-5.4",
    "grok-4.5",
    "glm-5.2",
    "kimi-k2.7-code",
    "MiniMax-M3",
    "composer-2.5",
    "deepseek-v4-pro",
  ];

  it.each(requiredModels)("seeds %s in pg catalog", (modelId) => {
    expect(pgSeed).toContain(`'${modelId}'`);
  });

  it("keeps Composer fixed and GLM model-driven", () => {
    expect(pgSeed).toContain('"thinkingFormat":"fixed"');
    expect(pgSeed).toContain('"thinkingFormat":"zai"');
  });

  it("maps Gemini 3 named thinking levels in pg", () => {
    for (const migration of [pgThinkingPatch]) {
      expect(migration).toContain('"minimal":"MINIMAL"');
      expect(migration).toContain('"high":"HIGH"');
      expect(migration).toContain("gemini-3.5-flash");
    }
  });

  it("distinguishes effort-capable and toggle-only compatible models", () => {
    for (const migration of [pgEffortPatch]) {
      expect(migration).toContain("reasoningEffort");
      expect(migration).toContain("glm-5.2");
      expect(migration).toContain("kimi-k2.6");
    }
  });

  it("seeds current Agnes Flash models with verified capabilities", () => {
    for (const migration of [pgAgnesCatalog]) {
      expect(migration).toContain("'agnes-1.5-flash'");
      expect(migration).toContain("'agnes-2.0-flash'");
      expect(migration).toContain('"thinkingFormat":"agnes"');
      expect(migration).toContain('"high":"2048"');
      expect(migration).toContain("524288");
      expect(migration).toContain("65536");
    }
  });
});
