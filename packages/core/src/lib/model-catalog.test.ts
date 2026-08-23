import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  findCatalogMatch,
  normalizeCatalogModelId,
  normalizeComparableModelId,
  rankSimilarModels,
} from "@/lib/model-catalog";
import { passesInvariants } from "@/lib/sync-pi-models";
import type { ModelCapabilities } from "@/db/types";

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
  const pgBaseline = readFileSync("drizzle/pg/0000_baseline.sql", "utf8");
  const catalogJson = pgBaseline.match(/\$model_catalog\$(.*)\$model_catalog\$/s)?.[1];
  const catalogRows = JSON.parse(catalogJson ?? "[]") as Array<{
    canonical_model_id: string;
    capabilities: Record<string, unknown>;
  }>;
  const catalogLine = (modelId: string): string | undefined => {
    const row = catalogRows.find((candidate) => candidate.canonical_model_id === modelId);
    return row ? JSON.stringify(row) : undefined;
  };
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
    expect(catalogLine(modelId)).toBeDefined();
  });

  it("keeps Composer fixed and GLM model-driven", () => {
    expect(catalogLine("composer-2.5")).toContain('"thinkingFormat":"fixed"');
    expect(catalogLine("glm-5.2")).toContain('"thinkingFormat":"zai"');
  });

  it("maps Gemini 3 named thinking levels in pg", () => {
    const line = catalogLine("gemini-3.5-flash");
    expect(line).toContain('"minimal":"MINIMAL"');
    expect(line).toContain('"high":"HIGH"');
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
    const glmLine = catalogLine("glm-5.2");
    expect(glmLine).toBeDefined();
    expect(glmLine).toContain('"low":null');
    expect(glmLine).toContain('"medium":null');
    expect(glmLine).not.toContain('"low":"high"');
    expect(glmLine).not.toContain('"medium":"high"');
  });

  it("exposes MiMo as a deepseek off/high toggle (pi-aligned)", () => {
    // 小米官方 MiMo 走 OpenAI 兼容端点,思考由 thinking:{type} 控制(pi: thinkingFormat=deepseek)。
    // 原配置缺 thinkingFormat,applyReasoningToCompatibleBody 早返回,off 不发 disabled → "关闭不生效"。
    for (const id of ["mimo-v2.5", "mimo-v2.5-pro"]) {
      const line = catalogLine(id);
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
    for (const id of ["glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"]) {
      const line = catalogLine(id);
      expect(line).toBeDefined();
      expect(line).toContain('"thinkingFormat":"zai"');
      expect(line).toContain('"low":null');
      expect(line).toContain('"medium":null');
    }
  });

  it("uses qwen format for DashScope Qwen3 toggle models", () => {
    // qwen3(阿里 DashScope)用顶层 enable_thinking 控制思考开关(toggle-only,可关闭)。
    for (const id of ["qwen3-235b-a22b", "qwen3-32b"]) {
      const line = catalogLine(id);
      expect(line).toBeDefined();
      expect(line).toContain('"thinkingFormat":"qwen"');
      expect(line).toContain('"low":null');
    }
  });

  it("uses openai reasoning_effort for StepFun (no disable, 3 levels)", () => {
    // StepFun step-3.7-flash 官方 Chat Completion API 用 reasoning_effort(low/medium/high),
    // 不支持 enable_thinking 也不支持关闭思考(推理模型默认总思考)→ off:null,只显示三档。
    const line = catalogLine("step-3.7-flash");
    expect(line).toBeDefined();
    expect(line).toContain('"thinkingFormat":"openai"');
    expect(line).toContain('"reasoningEffort":true');
    expect(line).toContain('"off":null');
    expect(line).toContain('"low":"low"');
    expect(line).toContain('"high":"high"');
  });

  it("seeds current Agnes Flash models with verified capabilities", () => {
    const agnes15 = catalogLine("agnes-1.5-flash");
    const agnes20 = catalogLine("agnes-2.0-flash");
    expect(agnes15).toBeDefined();
    expect(agnes20).toContain('"thinkingFormat":"agnes"');
    expect(agnes20).toContain('"high":"2048"');
    expect(agnes20).toContain("524288");
    expect(agnes20).toContain("65536");
  });
});

describe("model catalog baseline migration", () => {
  const migration = readFileSync("drizzle/pg/0000_baseline.sql", "utf8");
  const journal = JSON.parse(readFileSync("drizzle/pg/meta/_journal.json", "utf8")) as {
    entries: Array<{ idx: number; tag: string; breakpoints: boolean }>;
  };
  const snapshot = JSON.parse(readFileSync("drizzle/pg/meta/0000_snapshot.json", "utf8")) as {
    id: string;
    prevId: string;
    tables: Record<string, unknown>;
  };

  it("keeps the reviewed catalog seed in the immutable baseline", () => {
    expect(journal.entries[0]).toEqual({
      idx: 0,
      version: "7",
      when: expect.any(Number),
      tag: "0000_baseline",
      breakpoints: true,
    });
    expect(snapshot.id).toBeTypeOf("string");
    expect(snapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(snapshot.tables).toHaveProperty("public.model_catalog");
    const catalogJson = migration.match(/\$model_catalog\$(.*)\$model_catalog\$/s)?.[1] ?? "";
    const sourceHash = migration.match(/source-sha256: ([a-f0-9]{64})/)?.[1];
    expect(createHash("sha256").update(catalogJson).digest("hex")).toBe(sourceHash);
    expect(migration).toContain("jsonb_populate_recordset");
    for (const modelId of ["gemini-3.7-flash", "glm-5.3", "grok-4.6", "qwen3.8-max"]) {
      expect(migration).toContain(`\"canonical_model_id\":\"${modelId}\"`);
    }
  });
});

describe("model catalog reasoning migration", () => {
  const baseline = readFileSync("drizzle/pg/0000_baseline.sql", "utf8");
  const migration = readFileSync("drizzle/pg/0002_model_catalog_reasoning.sql", "utf8");
  const rows = JSON.parse(
    baseline.match(/\$model_catalog\$(.*)\$model_catalog\$/s)?.[1] ?? "[]",
  ) as Array<{ canonical_model_id: string; capabilities: ModelCapabilities }>;
  const reviewed = new Map([...migration.matchAll(
    /^\s+\('([^']+)', '(\{.*\})'::jsonb\),?$/gm,
  )].map((match) => [match[1], JSON.parse(match[2]) as ModelCapabilities]));
  const unverifiedBlock = migration.match(
    /WITH unverified\("canonical_model_id"\) AS \(\n  VALUES\n(.*?)\n\)\nUPDATE/s,
  )?.[1] ?? "";
  const unverified = new Set([...unverifiedBlock.matchAll(/^\s+\('([^']+)'\),?$/gm)]
    .map((match) => match[1]));
  const reasoningKeys: Array<keyof ModelCapabilities> = [
    "reasoning", "reasoningEffort", "thinkingFormat", "thinkingLevelMap",
  ];
  const withoutReasoning = (capabilities: ModelCapabilities): ModelCapabilities => {
    const next = { ...capabilities };
    for (const key of reasoningKeys) delete next[key];
    return next;
  };
  const finalRows = rows.map((row) => {
    const bundle = reviewed.get(row.canonical_model_id);
    const capabilities = bundle
      ? { ...withoutReasoning(row.capabilities), ...bundle }
      : unverified.has(row.canonical_model_id)
        && row.capabilities.reasoning === true
        && !row.capabilities.thinkingFormat
        ? withoutReasoning(row.capabilities)
        : row.capabilities;
    return { ...row, capabilities };
  });

  it("修复 51 条有证据的目录并降级其余非法 bundle", () => {
    expect(rows.filter((row) => row.capabilities.reasoning === true
      && !passesInvariants(row.capabilities))).toHaveLength(271);
    expect(reviewed).toHaveLength(51);
    expect(unverified).toHaveLength(220);
    expect(new Set([...reviewed.keys(), ...unverified])).toEqual(new Set(rows
      .filter((row) => row.capabilities.reasoning === true && !passesInvariants(row.capabilities))
      .map((row) => row.canonical_model_id)));
    expect(finalRows.filter((row) => row.capabilities.reasoning === true
      && !passesInvariants(row.capabilities))).toEqual([]);
  });

  it("只修改 reasoning bundle 且 SQL 可重复执行", () => {
    for (const [index, row] of rows.entries()) {
      expect(withoutReasoning(finalRows[index].capabilities)).toEqual(
        withoutReasoning(row.capabilities),
      );
    }
    expect(migration).toContain('"capabilities" IS DISTINCT FROM');
    expect(migration).toContain('NOT (catalog."capabilities" ? \'thinkingFormat\')');
  });

  it("保持 Drizzle journal 与 snapshot 链连续", () => {
    const journal = JSON.parse(readFileSync("drizzle/pg/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const previous = JSON.parse(readFileSync("drizzle/pg/meta/0001_snapshot.json", "utf8")) as {
      id: string;
    };
    const current = JSON.parse(readFileSync("drizzle/pg/meta/0002_snapshot.json", "utf8")) as {
      id: string;
      prevId: string;
    };
    const next = JSON.parse(readFileSync("drizzle/pg/meta/0003_snapshot.json", "utf8")) as {
      id: string;
      prevId: string;
    };
    expect(journal.entries.slice(-2)).toEqual([
      {
        idx: 2,
        version: "7",
        when: expect.any(Number),
        tag: "0002_model_catalog_reasoning",
        breakpoints: true,
      },
      {
        idx: 3,
        version: "7",
        when: expect.any(Number),
        tag: "0003_complex_slayback",
        breakpoints: true,
      },
    ]);
    expect(current.id).not.toBe(previous.id);
    expect(current.prevId).toBe(previous.id);
    expect(next.id).not.toBe(current.id);
    expect(next.prevId).toBe(current.id);
  });
});
