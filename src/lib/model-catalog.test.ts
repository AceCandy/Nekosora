import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  findCatalogMatch,
  normalizeCatalogModelId,
  normalizeComparableModelId,
  rankSimilarModels,
} from "@/lib/model-catalog";

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

describe("rankSimilarModels", () => {
  const models = [
    {
      id: "model-glm",
      name: "glm-5.2",
      catalogId: "catalog-glm",
      canonicalModelId: "glm-5.2",
      aliases: ["zai/glm-5.2", "volcengine/glm-5.2"],
    },
    {
      id: "model-sonnet",
      name: "claude-sonnet-4",
      catalogId: "catalog-sonnet",
      canonicalModelId: "claude-sonnet-4",
      aliases: ["anthropic/claude-sonnet-4"],
    },
    {
      id: "model-opus",
      name: "claude-opus-4",
      catalogId: "catalog-opus",
      canonicalModelId: "claude-opus-4",
      aliases: [],
    },
    {
      id: "model-llama-8b",
      name: "llama-3.1-8b",
      catalogId: "catalog-generic",
      canonicalModelId: "__generic_chat__",
      aliases: [],
    },
    {
      id: "model-llama-70b",
      name: "llama-3.1-70b",
      catalogId: "catalog-generic",
      canonicalModelId: "__generic_chat__",
      aliases: [],
    },
    {
      id: "model-gpt-4o",
      name: "gpt-4o",
      catalogId: "catalog-gpt-4o",
      canonicalModelId: "gpt-4o",
      aliases: [],
    },
    {
      id: "model-gpt-4-1",
      name: "gpt-4.1",
      catalogId: "catalog-gpt-4-1",
      canonicalModelId: "gpt-4.1",
      aliases: [],
    },
  ];

  it("归一厂商命名空间、大小写和分隔符，但保留模型版本", () => {
    expect(normalizeComparableModelId(" OpenAI/GLM_5.2 ")).toBe("glm-5.2");
    expect(normalizeComparableModelId("gpt-4.1-mini")).toBe("gpt-4.1-mini");
  });

  it("优先返回目录别名或归一 ID 命中的候选", () => {
    expect(rankSimilarModels(models, "zai/glm-5.2").map((model) => model.id)).toEqual([
      "model-glm",
    ]);
    expect(rankSimilarModels(models, "GLM_5.2").map((model) => model.id)).toEqual([
      "model-glm",
    ]);
  });

  it("将明确发布日期和 latest 后缀视为同模型变体", () => {
    expect(rankSimilarModels(models, "claude-sonnet-4-20250514")[0]?.id).toBe("model-sonnet");
    expect(rankSimilarModels(models, "claude-sonnet-4-2025-05-14")[0]?.id).toBe("model-sonnet");
    expect(rankSimilarModels(models, "claude-sonnet-4-latest")[0]?.id).toBe("model-sonnet");
  });

  it("支持词元顺序差异和完整 ID 扩展候选", () => {
    expect(rankSimilarModels(models, "claude-4-sonnet")[0]?.id).toBe("model-sonnet");
    expect(rankSimilarModels(models, "gpt-4o-mini")[0]?.id).toBe("model-gpt-4o");
  });

  it("排除不同系列、版本和参数规模的误匹配", () => {
    expect(rankSimilarModels(models, "claude-sonnet-4").map((model) => model.id)).not.toContain("model-opus");
    expect(rankSimilarModels(models, "gpt-4o").map((model) => model.id)).not.toContain("model-gpt-4-1");
    expect(rankSimilarModels(models, "llama-3.1-8b").map((model) => model.id)).not.toContain("model-llama-70b");
  });

  it("排除严格同名模型并稳定限制为前五条", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      id: `model-${index}`,
      name: `qwen2.5-coder-${index + 1}b`,
      catalogId: "catalog-generic",
      canonicalModelId: "__generic_chat__",
      aliases: [],
    }));

    expect(rankSimilarModels(many, "qwen2.5-coder").map((model) => model.id)).toEqual([
      "model-0",
      "model-1",
      "model-2",
      "model-3",
      "model-4",
    ]);
    expect(rankSimilarModels(models, "glm-5.2")).toEqual([]);
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

describe("Kimi fixed reasoning repair migration", () => {
  const migration = readFileSync("drizzle/pg/0011_fix_kimi_fixed_reasoning.sql", "utf8");
  const journal = JSON.parse(readFileSync("drizzle/pg/meta/_journal.json", "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
  };
  const previousSnapshot = JSON.parse(readFileSync("drizzle/pg/meta/0010_snapshot.json", "utf8")) as {
    id: string;
    prevId: string;
    [key: string]: unknown;
  };
  const currentSnapshot = JSON.parse(readFileSync("drizzle/pg/meta/0011_snapshot.json", "utf8")) as {
    id: string;
    prevId: string;
    [key: string]: unknown;
  };

  it("repairs both Kimi K2.7 rows while preserving unrelated capabilities", () => {
    expect(migration).toContain('UPDATE "model_catalog"');
    expect(migration).toContain('"capabilities" = "capabilities" ||');
    expect(migration).toContain('"updated_at" = now()');

    const patchMatch = migration.match(/\|\|\s*'(\{[^\n]+\})'::jsonb/);
    expect(patchMatch).not.toBeNull();
    const capabilityPatch = JSON.parse(patchMatch?.[1] ?? "{}") as Record<string, unknown>;
    const expectedPatch = {
      thinkingFormat: "fixed",
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: "default",
        xhigh: null,
        max: null,
      },
    };
    expect(capabilityPatch).toEqual(expectedPatch);
    expect({ tools: true, vision: true, ...capabilityPatch })
      .toEqual({ tools: true, vision: true, ...expectedPatch });

    const targetMatch = migration.match(/WHERE\s+"canonical_model_id"\s+IN\s*\(([\s\S]*?)\);/);
    expect(targetMatch).not.toBeNull();
    const targetIds = [...(targetMatch?.[1] ?? "").matchAll(/'([^']+)'/g)]
      .map((match) => match[1]);
    expect(targetIds).toEqual(["kimi-k2.7-code", "kimi-k2.7-code-highspeed"]);
  });

  it("appends migration metadata without changing the schema snapshot", () => {
    const currentEntryIndex = journal.entries.findIndex(
      (entry) => entry.tag === "0011_fix_kimi_fixed_reasoning",
    );
    expect(currentEntryIndex).toBeGreaterThan(0);
    const previousEntry = journal.entries[currentEntryIndex - 1];
    const currentEntry = journal.entries[currentEntryIndex];
    expect(previousEntry).toBeDefined();
    expect(currentEntry).toMatchObject({
      idx: 11,
      tag: "0011_fix_kimi_fixed_reasoning",
      breakpoints: true,
    });
    expect(currentEntry?.when).toBeGreaterThan(previousEntry?.when ?? Number.POSITIVE_INFINITY);

    const { id: previousId, prevId: previousPrevId, ...previousSchema } = previousSnapshot;
    const { id: currentId, prevId: currentPrevId, ...currentSchema } = currentSnapshot;
    expect(currentPrevId).toBe(previousId);
    expect(currentId).not.toBe(previousId);
    expect(previousPrevId).toBeTypeOf("string");
    expect(currentSchema).toEqual(previousSchema);
  });
});
