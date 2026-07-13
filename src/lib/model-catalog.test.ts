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
  // squash 后模型目录数据基线统一在 0000_baseline.sql(原 0016-0019 已合并)
  const pgBaseline = readFileSync("drizzle/pg/0000_baseline.sql", "utf8");
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
    expect(pgBaseline).toContain(`'${modelId}'`);
  });

  it("keeps Composer fixed and GLM model-driven", () => {
    expect(pgBaseline).toContain('"thinkingFormat":"fixed"');
    expect(pgBaseline).toContain('"thinkingFormat":"zai"');
  });

  it("maps Gemini 3 named thinking levels in pg", () => {
    for (const migration of [pgBaseline]) {
      expect(migration).toContain('"minimal":"MINIMAL"');
      expect(migration).toContain('"high":"HIGH"');
      expect(migration).toContain("gemini-3.5-flash");
    }
  });

  it("distinguishes effort-capable and toggle-only compatible models", () => {
    for (const migration of [pgBaseline]) {
      expect(migration).toContain("reasoningEffort");
      expect(migration).toContain("glm-5.2");
      expect(migration).toContain("kimi-k2.6");
    }
  });

  it("exposes only real GLM 5.2 reasoning levels (low/medium must be null)", () => {
    // glm-5.2 上游 reasoning_effort 只区分 high/max;low/medium 必须为 null,
    // 否则 Chat 会显示「低/中」假档位(都塌缩成 high)。
    const glmLine = pgBaseline.split("\n").find((l) => l.includes("'catalog-glm-5-2'"));
    expect(glmLine).toBeDefined();
    expect(glmLine).toContain('"low":null');
    expect(glmLine).toContain('"medium":null');
    expect(glmLine).not.toContain('"low":"high"');
    expect(glmLine).not.toContain('"medium":"high"');
  });

  it("exposes MiMo as a deepseek off/high toggle (pi-aligned)", () => {
    // 小米官方 MiMo 走 OpenAI 兼容端点,思考由 thinking:{type} 控制(pi: thinkingFormat=deepseek)。
    // 原配置缺 thinkingFormat,applyReasoningToCompatibleBody 早返回,off 不发 disabled → "关闭不生效"。
    for (const id of ["catalog-mimo-v2-5", "catalog-mimo-v2-5-pro"]) {
      const line = pgBaseline.split("\n").find((l) => l.includes(`'${id}'`));
      expect(line).toBeDefined();
      expect(line).toContain('"thinkingFormat":"deepseek"');
      expect(line).toContain('"low":null');
      expect(line).toContain('"medium":null');
      expect(line).not.toContain('"thinkingFormat":"openrouter"');
    }
  });

  it("exposes zai GLM toggle-only models as off/high (pi: no reasoning effort)", () => {
    // pi 明确 glm-4.7/5-turbo/5.1/5v-turbo 均为 supportsReasoningEffort:false,即 toggle-only
    // (只发 thinking.type)。缺 map 会显示 5 档假档位,统一收敛为 off/high(glm-5.2 除外,它支持 high/max)。
    for (const id of ["catalog-glm-4-7", "catalog-glm-5-turbo", "catalog-glm-5-1", "catalog-glm-5v-turbo"]) {
      const line = pgBaseline.split("\n").find((l) => l.includes(`'${id}'`));
      expect(line).toBeDefined();
      expect(line).toContain('"thinkingFormat":"zai"');
      expect(line).toContain('"low":null');
      expect(line).toContain('"medium":null');
    }
  });

  it("uses qwen format for DashScope Qwen3 toggle models", () => {
    // qwen3(阿里 DashScope)用顶层 enable_thinking 控制思考开关(toggle-only,可关闭)。
    for (const id of ["catalog-qwen3-235b-a22b", "catalog-qwen3-32b"]) {
      const line = pgBaseline.split("\n").find((l) => l.includes(`'${id}'`));
      expect(line).toBeDefined();
      expect(line).toContain('"thinkingFormat":"qwen"');
      expect(line).toContain('"low":null');
    }
  });

  it("uses openai reasoning_effort for StepFun (no disable, 3 levels)", () => {
    // StepFun step-3.7-flash 官方 Chat Completion API 用 reasoning_effort(low/medium/high),
    // 不支持 enable_thinking 也不支持关闭思考(推理模型默认总思考)→ off:null,只显示三档。
    const line = pgBaseline.split("\n").find((l) => l.includes("'catalog-step-3-7-flash'"));
    expect(line).toBeDefined();
    expect(line).toContain('"thinkingFormat":"openai"');
    expect(line).toContain('"reasoningEffort":true');
    expect(line).toContain('"off":null');
    expect(line).toContain('"low":"low"');
    expect(line).toContain('"high":"high"');
  });

  it("seeds current Agnes Flash models with verified capabilities", () => {
    for (const migration of [pgBaseline]) {
      expect(migration).toContain("'agnes-1.5-flash'");
      expect(migration).toContain("'agnes-2.0-flash'");
      expect(migration).toContain('"thinkingFormat":"agnes"');
      expect(migration).toContain('"high":"2048"');
      expect(migration).toContain("524288");
      expect(migration).toContain("65536");
    }
  });
});
