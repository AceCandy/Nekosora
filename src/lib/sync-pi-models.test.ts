import { describe, it, expect } from "vitest";
import {
  match, decodePiModelsApi, planCatalogSync,
  passesInvariants, buildCatalogSyncSql, nextDataMigrationSnapshot,
  nextSyncMigrationSlot, stableJson,
  type PiModel, type CatalogRow,
} from "./sync-pi-models";
import type { ModelCapabilities } from "@/db/types";

const pi = (over: Partial<PiModel> = {}): PiModel => ({ id: "x", ...over });
const cap = (o: Partial<ModelCapabilities>): ModelCapabilities => o as ModelCapabilities;
const row = (over: Partial<CatalogRow>): CatalogRow => ({
  canonicalModelId: "model",
  name: "Model",
  aliases: [],
  capabilities: {},
  contextWindow: null,
  maxOutputTokens: null,
  ...over,
});

describe("match", () => {
  const PI = {
    zai: { "glm-5.2": pi({ id: "glm-5.2", compat: { thinkingFormat: "zai" } }) },
    moonshotai: { "kimi-k2-0711-preview": pi({ id: "kimi-k2-0711-preview" }) },
    "moonshotai-cn": { "kimi-k2-0711-preview": pi({ id: "kimi-k2-0711-preview" }) },
    opencode: { "glm-5.2": pi({ id: "glm-5.2" }) },
    openrouter: {
      "openai/gpt-oss-120b": pi({ id: "openai/gpt-oss-120b", contextWindow: 131072, maxTokens: 131072 }),
    },
    together: {
      "openai/gpt-oss-120b": pi({ id: "openai/gpt-oss-120b", contextWindow: 131072, maxTokens: 65536 }),
    },
    nvidia: {
      "nvidia/nemotron-3-nano-30b-a3b": pi({
        id: "nvidia/nemotron-3-nano-30b-a3b",
        contextWindow: 131072,
        maxTokens: 131072,
      }),
    },
    google: {
      "gemma-4-31b-it": pi({ id: "gemma-4-31b-it", contextWindow: 262144, maxTokens: 32768, reasoning: true }),
    },
  } as unknown as Record<string, Record<string, PiModel>>;

  it("精确 provider/id 命中", () => {
    expect(match("glm-5.2", ["zai/glm-5.2", "zhipu/glm-5.2"], PI)).toMatchObject({
      provider: "zai",
      modelKey: "glm-5.2",
      kind: "provider-id",
      authority: "direct",
      via: "zai/glm-5.2",
    });
  });
  it("唯一官方 bare id 可直接提案,区域变体不制造歧义", () => {
    expect(match("kimi-k2", ["moonshot/kimi-k2", "kimi-k2-0711-preview"], PI)).toMatchObject({
      provider: "moonshotai",
      modelKey: "kimi-k2-0711-preview",
      kind: "unique-bare-id",
      authority: "direct",
    });
  });
  it("聚合 provider 不抢占主 provider 命中(opencode 让位 zai)", () => {
    expect(match("glm-5.2", ["zai/glm-5.2"], PI)?.via).toBe("zai/glm-5.2");
  });
  it("全路径 key 命中(openrouter 的 openai/gpt-oss-120b)", () => {
    const m = match("gpt-oss-120b", ["openai/gpt-oss-120b"], PI);
    expect(m).toMatchObject({
      provider: "openrouter",
      modelKey: "openai/gpt-oss-120b",
      kind: "path",
      authority: "reference",
    });
    expect(m?.pi.maxTokens).toBe(131072);
  });
  it("nvidia 嵌套 key 可被 nvidia/ 前缀别名命中", () => {
    // 精确 provider/id: nvidia + nvidia/nemotron... 需要别名写成 nvidia/nvidia/...
    // 全路径 key 路径: 别名 nvidia/nemotron-3-nano-30b-a3b 在 nvidia provider 下作 key
    const m = match("nemotron-3-nano-30b-a3b", ["nvidia/nemotron-3-nano-30b-a3b"], PI);
    expect(m).toMatchObject({
      provider: "nvidia",
      modelKey: "nvidia/nemotron-3-nano-30b-a3b",
      kind: "path",
      authority: "reference",
    });
  });
  it("官方 provider 的 tail 命中也只供审计", () => {
    const catalog = {
      stepfun: {
        "stepfun-ai/Step-3.5-Flash": pi({ id: "stepfun-ai/Step-3.5-Flash" }),
      },
    };
    expect(match("step-3.5-flash", [], catalog)).toMatchObject({
      provider: "stepfun",
      modelKey: "stepfun-ai/Step-3.5-Flash",
      kind: "tail",
      authority: "reference",
    });
  });
  it("多个官方 provider 的 bare id 歧义只能审计", () => {
    const catalog = {
      vendorA: { shared: pi({ id: "shared" }) },
      vendorB: { shared: pi({ id: "shared" }) },
    };
    expect(match("shared", [], catalog)).toMatchObject({
      kind: "ambiguous-bare-id",
      authority: "reference",
      reason: "ambiguous_direct_match",
    });
  });
  it("多个官方 provider/id 精确标识互相冲突时也只能审计", () => {
    const catalog = {
      vendorA: { model: pi({ id: "model" }) },
      vendorB: { other: pi({ id: "other" }) },
    };
    expect(match("model", ["vendorA/model", "vendorB/other"], catalog)).toMatchObject({
      kind: "ambiguous-provider-id",
      authority: "reference",
      reason: "ambiguous_direct_match",
    });
  });
  it("未匹配返回 null", () => {
    expect(match("nope", [], PI)).toBeNull();
  });
});

describe("decodePiModelsApi", () => {
  it("保留 missing/false/true 三态和合法供应商映射值", () => {
    const decoded = decodePiModelsApi({
      openai: {
        "gpt-5-chat-latest": {
          id: "gpt-5-chat-latest",
          name: "GPT-5 Chat Latest",
          reasoning: false,
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 16384,
          compat: { supportsReasoningEffort: false },
          thinkingLevelMap: { off: "none", minimal: null, high: "HIGH" },
          cost: { input: 1 },
        },
        "gpt-5-thinking": {
          id: "gpt-5-thinking",
          reasoning: true,
          compat: { supportsReasoningEffort: true },
        },
        "gpt-5-unspecified": { id: "gpt-5-unspecified" },
      },
    });
    const models = decoded.catalog.openai;
    expect(models["gpt-5-chat-latest"]).toMatchObject({
      reasoning: false,
      compat: { supportsReasoningEffort: false },
      thinkingLevelMap: { off: "none", minimal: null, high: "HIGH" },
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 16384,
    });
    expect(models["gpt-5-thinking"].reasoning).toBe(true);
    expect(models["gpt-5-unspecified"].reasoning).toBeUndefined();
    expect(models["gpt-5-unspecified"].compat).toBeUndefined();
    expect(decoded.rejections).toEqual([]);
  });

  it.each([
    [{ turbo: "high" }, "invalid_map_key"],
    [{ high: 1 }, "invalid_map_value"],
    [{ high: "   " }, "invalid_map_value"],
  ] as const)("拒绝整个非法 thinkingLevelMap: %s", (thinkingLevelMap, code) => {
    const decoded = decodePiModelsApi({
      zai: { "glm-5.2": { id: "glm-5.2", reasoning: true, thinkingLevelMap } },
    });
    expect(decoded.catalog.zai["glm-5.2"].thinkingLevelMap).toBeUndefined();
    expect(decoded.rejections).toEqual([{
      provider: "zai",
      modelKey: "glm-5.2",
      scope: "reasoning",
      code,
    }]);
  });

  it("拒绝非法 compat boolean 而不丢弃同一 provider 的合法模型", () => {
    const decoded = decodePiModelsApi({
      zai: {
        bad: { id: "bad", compat: { supportsReasoningEffort: "yes" } },
        good: { id: "good", compat: { supportsReasoningEffort: false } },
      },
    });
    expect(decoded.catalog.zai.good.compat?.supportsReasoningEffort).toBe(false);
    expect(decoded.catalog.zai.bad.compat?.supportsReasoningEffort).toBeUndefined();
    expect(decoded.rejections).toEqual([{
      provider: "zai",
      modelKey: "bad",
      scope: "reasoning",
      code: "invalid_compat_boolean",
    }]);
  });

  it("拒绝非法模型与字段形状,同时保留同一 payload 的合法条目", () => {
    const decoded = decodePiModelsApi({
      brokenProvider: [],
      zai: {
        brokenModel: null,
        badReasoning: { id: "badReasoning", reasoning: "true" },
        badCompat: { id: "badCompat", compat: [] },
        badFormat: { id: "badFormat", compat: { thinkingFormat: "invented" } },
        badMap: { id: "badMap", thinkingLevelMap: [] },
        badInput: { id: "badInput", input: ["text", 1] },
        badContext: { id: "badContext", contextWindow: -1 },
        badMax: { id: "badMax", maxTokens: Number.NaN },
        good: { id: "good", reasoning: false, input: ["text"] },
      },
    });

    expect(decoded.catalog.zai.good).toMatchObject({ id: "good", reasoning: false });
    expect(decoded.catalog.zai.brokenModel).toBeUndefined();
    expect(decoded.catalog.zai.badReasoning.reasoning).toBeUndefined();
    expect(decoded.catalog.zai.badCompat.compat).toBeUndefined();
    expect(decoded.catalog.zai.badFormat.compat).toBeUndefined();
    expect(decoded.catalog.zai.badMap.thinkingLevelMap).toBeUndefined();
    expect(decoded.catalog.zai.badInput.input).toBeUndefined();
    expect(decoded.catalog.zai.badContext.contextWindow).toBeUndefined();
    expect(decoded.catalog.zai.badMax.maxTokens).toBeUndefined();
    expect(decoded.rejections).toEqual(expect.arrayContaining([
      { provider: "brokenProvider", scope: "model", code: "invalid_provider_models" },
      { provider: "zai", modelKey: "brokenModel", scope: "model", code: "invalid_model" },
      { provider: "zai", modelKey: "badReasoning", scope: "reasoning", code: "invalid_reasoning_boolean" },
      { provider: "zai", modelKey: "badCompat", scope: "reasoning", code: "invalid_compat_object" },
      { provider: "zai", modelKey: "badFormat", scope: "reasoning", code: "invalid_thinking_format" },
      { provider: "zai", modelKey: "badMap", scope: "reasoning", code: "invalid_map_shape" },
      { provider: "zai", modelKey: "badInput", scope: "vision", code: "invalid_input" },
      { provider: "zai", modelKey: "badContext", scope: "model", code: "invalid_context_window" },
      { provider: "zai", modelKey: "badMax", scope: "model", code: "invalid_max_tokens" },
    ]));
  });

  it("缺失、空白或非字符串 id 时拒绝整个模型", () => {
    const decoded = decodePiModelsApi({
      zai: {
        missing: { reasoning: true },
        empty: { id: "   ", reasoning: true },
        numeric: { id: 1, reasoning: true },
        good: { id: "good", reasoning: false },
      },
    });
    expect(Object.keys(decoded.catalog.zai)).toEqual(["good"]);
    for (const modelKey of ["missing", "empty", "numeric"]) {
      expect(decoded.rejections).toContainEqual({
        provider: "zai",
        modelKey,
        scope: "model",
        code: "invalid_model_id",
      });
    }
  });

  it("顶层 payload 非对象时以稳定错误码失败", () => {
    expect(() => decodePiModelsApi([])).toThrowError(expect.objectContaining({
      code: "invalid_payload_root",
    }));
  });
});

describe("planCatalogSync", () => {
  it("direct 匹配可升降 vision 并更新明确存在的窗口字段", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "gpt-5-chat",
      name: "GPT-5 Chat",
      aliases: ["openai/gpt-5-chat-latest", "gpt-5-chat-latest"],
      capabilities: { tools: true, systemPrompt: true },
      contextWindow: null,
      maxOutputTokens: null,
    })], {
      openai: {
        "gpt-5-chat-latest": {
          id: "gpt-5-chat-latest",
          contextWindow: 128000,
          maxTokens: 16384,
          input: ["text", "image"],
        },
      },
    });
    expect(plan.matched).toBe(1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].operations).toEqual(expect.arrayContaining([
      { target: "capability", action: "set", key: "vision", value: true },
      { target: "column", action: "set", column: "contextWindow", value: 128000 },
      { target: "column", action: "set", column: "maxOutputTokens", value: 16384 },
    ]));
  });

  it("direct reasoning=false 删除整个 reasoning bundle 并保留无关能力", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "kimi-k2",
      aliases: ["moonshotai/kimi-k2-0711-preview"],
      capabilities: {
        tools: true,
        systemPrompt: true,
        reasoning: true,
        reasoningEffort: true,
        thinkingFormat: "deepseek",
        thinkingLevelMap: { off: "none", high: "high" },
      },
    })], {
      moonshotai: {
        "kimi-k2-0711-preview": {
          id: "kimi-k2-0711-preview",
          reasoning: false,
          input: ["text"],
          compat: { thinkingFormat: "deepseek", supportsReasoningEffort: false },
          thinkingLevelMap: { high: "high" },
        },
      },
    });
    const change = plan.changes[0];
    expect(change.nextCapabilities).toEqual({ tools: true, systemPrompt: true });
    expect(change.operations).toEqual(expect.arrayContaining([
      { target: "capability", action: "delete", key: "reasoning" },
      { target: "capability", action: "delete", key: "reasoningEffort" },
      { target: "capability", action: "delete", key: "thinkingFormat" },
      { target: "capability", action: "delete", key: "thinkingLevelMap" },
    ]));
    expect(plan.rejections).toContainEqual(expect.objectContaining({
      canonicalModelId: "kimi-k2",
      code: "reasoning_disabled_extras_ignored",
    }));
  });

  it("未启用 reasoning 的孤立 thinking 元数据只审计保留", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "dormant-model",
      aliases: ["vendor/dormant-model"],
      capabilities: { tools: true, thinkingFormat: "deepseek" },
    })], {
      vendor: {
        "dormant-model": {
          id: "dormant-model",
          reasoning: false,
          compat: { thinkingFormat: "deepseek", supportsReasoningEffort: false },
        },
      },
    });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.rejections).toContainEqual(expect.objectContaining({
      canonicalModelId: "dormant-model",
      code: "reasoning_disabled_extras_ignored",
    }));
  });

  it("reasoning=false 仅携带显式 effort=false 也记录忽略审计", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "non-reasoning-model",
      aliases: ["vendor/non-reasoning-model"],
      capabilities: { tools: true },
    })], {
      vendor: {
        "non-reasoning-model": {
          id: "non-reasoning-model",
          reasoning: false,
          compat: { supportsReasoningEffort: false },
        },
      },
    });
    expect(plan.changes).toEqual([]);
    expect(plan.rejections).toContainEqual(expect.objectContaining({
      canonicalModelId: "non-reasoning-model",
      code: "reasoning_disabled_extras_ignored",
    }));
  });

  it("稀疏旧 bundle 降级时仍生成四个规范化删除操作", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "sparse-reasoning-model",
      aliases: ["vendor/sparse-reasoning-model"],
      capabilities: { tools: true, reasoning: true, thinkingFormat: "deepseek" },
    })], {
      vendor: {
        "sparse-reasoning-model": {
          id: "sparse-reasoning-model",
          reasoning: false,
        },
      },
    });
    expect(plan.changes[0].operations).toEqual([
      { target: "capability", action: "delete", key: "reasoning" },
      { target: "capability", action: "delete", key: "reasoningEffort" },
      { target: "capability", action: "delete", key: "thinkingFormat" },
      { target: "capability", action: "delete", key: "thinkingLevelMap" },
    ]);
  });

  it("direct reasoning=true 从 false 建立完整合法 bundle", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "reasoning-model",
      aliases: ["vendor/reasoning-model"],
      capabilities: { tools: true, reasoning: false },
    })], {
      vendor: {
        "reasoning-model": {
          id: "reasoning-model",
          reasoning: true,
          compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
          thinkingLevelMap: { off: "none", high: "high", max: "max" },
        },
      },
    });
    expect(plan.changes[0].nextCapabilities).toEqual({
      reasoning: true,
      reasoningEffort: true,
      thinkingFormat: "zai",
      thinkingLevelMap: { high: "high", max: "max", off: "none" },
      tools: true,
    });
    expect(plan.changes[0].operations).toEqual(expect.arrayContaining([
      { target: "capability", action: "set", key: "reasoning", value: true },
      { target: "capability", action: "set", key: "reasoningEffort", value: true },
      { target: "capability", action: "set", key: "thinkingFormat", value: "zai" },
    ]));
  });

  it("reasoning bundle 非法时完整保留旧包,独立 vision 降级仍生效", () => {
    const currentBundle: ModelCapabilities = {
      tools: true,
      vision: true,
      reasoning: true,
      reasoningEffort: true,
      thinkingFormat: "zai",
      thinkingLevelMap: { off: "none", high: "high", max: "max" },
    };
    const plan = planCatalogSync([row({
      canonicalModelId: "glm-5.2",
      aliases: ["zai/glm-5.2"],
      capabilities: currentBundle,
    })], {
      zai: {
        "glm-5.2": {
          id: "glm-5.2",
          reasoning: true,
          input: ["text"],
          compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
          thinkingLevelMap: { off: "none", high: "" },
        },
      },
    });
    expect(plan.changes[0].nextCapabilities).toEqual({
      tools: true,
      reasoning: true,
      reasoningEffort: true,
      thinkingFormat: "zai",
      thinkingLevelMap: { off: "none", high: "high", max: "max" },
    });
    expect(plan.changes[0].operations).toEqual([
      { target: "capability", action: "delete", key: "vision" },
    ]);
    expect(plan.rejections).toContainEqual({
      provider: "zai",
      modelKey: "glm-5.2",
      canonicalModelId: "glm-5.2",
      scope: "reasoning",
      code: "invalid_map_value",
    });
  });

  it.each([
    {
      missing: "map",
      compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
    },
    {
      missing: "effort 三态",
      compat: { thinkingFormat: "zai" },
      thinkingLevelMap: { off: "none", high: "high" },
    },
    {
      missing: "map 与 effort 三态",
      compat: { thinkingFormat: "zai" },
    },
  ])("跨格式 proposal 缺少$missing时完整保留旧 reasoning bundle", ({
    compat,
    thinkingLevelMap,
  }) => {
    const plan = planCatalogSync([row({
      canonicalModelId: "atomic-reasoning-model",
      aliases: ["vendor/atomic-reasoning-model"],
      capabilities: {
        reasoning: true,
        reasoningEffort: true,
        thinkingFormat: "deepseek",
        thinkingLevelMap: { off: "none", high: "high" },
      },
    })], {
      vendor: {
        "atomic-reasoning-model": {
          id: "atomic-reasoning-model",
          reasoning: true,
          compat,
          ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        },
      },
    });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.rejections).toContainEqual(expect.objectContaining({
      canonicalModelId: "atomic-reasoning-model",
      code: "invalid_reasoning_bundle",
    }));
  });

  it("reference 匹配只记录审计 proposal,不进入 accepted changes", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "gpt-oss-120b",
      aliases: ["openai/gpt-oss-120b"],
      capabilities: { tools: true, vision: true },
      contextWindow: 64000,
    })], {
      openrouter: {
        "openai/gpt-oss-120b": {
          id: "openai/gpt-oss-120b",
          input: ["text"],
          contextWindow: 131072,
        },
      },
    });
    expect(plan.changes).toEqual([]);
    expect(plan.references).toHaveLength(1);
    expect(plan.references[0]).toMatchObject({
      canonicalModelId: "gpt-oss-120b",
      match: { authority: "reference", kind: "path" },
    });
    expect(plan.references[0].operations).toEqual(expect.arrayContaining([
      { target: "capability", action: "delete", key: "vision" },
      { target: "column", action: "set", column: "contextWindow", value: 131072 },
    ]));
  });

  it("上游字段 missing 时保留目录值", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "glm-5.2",
      aliases: ["zai/glm-5.2"],
      capabilities: { vision: true, reasoning: true, thinkingFormat: "zai" },
      contextWindow: 1000,
    })], { zai: { "glm-5.2": { id: "glm-5.2" } } });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("通用模板与真实未匹配分开记录", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "__generic_chat__",
      name: "通用",
    }), row({ canonicalModelId: "missing" })], { openai: {} });
    expect(plan.unmatched).toEqual({ generic: ["__generic_chat__"], catalog: ["missing"] });
    expect(plan.matched).toBe(0);
  });
});

describe("deterministic plan", () => {
  it("递归排序嵌套对象且保留数组顺序", () => {
    expect(stableJson({ b: { y: 2, x: 1 }, a: [{ d: 4, c: 3 }] }))
      .toBe('{"a":[{"c":3,"d":4}],"b":{"x":1,"y":2}}');
  });

  it("catalog、provider 和 thinking map 输入顺序不影响 plan", () => {
    const rowA = row({
      canonicalModelId: "a-model",
      aliases: ["zai/a-model"],
      capabilities: { reasoning: true, thinkingFormat: "zai", thinkingLevelMap: { high: "high" } },
    });
    const rowB = row({
      canonicalModelId: "b-model",
      aliases: ["zai/b-model"],
      capabilities: { reasoning: true, thinkingFormat: "zai", thinkingLevelMap: { high: "high" } },
    });
    const first = planCatalogSync([rowB, rowA], {
      unused: {},
      zai: {
        "b-model": {
          id: "b-model",
          reasoning: true,
          compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
          thinkingLevelMap: { max: "max", high: "high", off: "none" },
        },
        "a-model": {
          id: "a-model",
          reasoning: true,
          compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
          thinkingLevelMap: { off: "none", high: "high", max: "max" },
        },
      },
    });
    const second = planCatalogSync([rowA, rowB], {
      zai: {
        "a-model": {
          thinkingLevelMap: { max: "max", high: "high", off: "none" },
          compat: { supportsReasoningEffort: true, thinkingFormat: "zai" },
          reasoning: true,
          id: "a-model",
        },
        "b-model": {
          thinkingLevelMap: { off: "none", high: "high", max: "max" },
          compat: { supportsReasoningEffort: true, thinkingFormat: "zai" },
          reasoning: true,
          id: "b-model",
        },
      },
      unused: {},
    });
    expect(stableJson(first)).toBe(stableJson(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.changes.map((change) => change.canonicalModelId)).toEqual(["a-model", "b-model"]);
  });
});

describe("web search capabilities", () => {
  it("只按官方 provider、API 语义和精确型号标记原生搜索", () => {
    const models = [
      ["gpt-5.5", "openai", "openai-responses", "openai"],
      ["claude-opus-5", "anthropic", "anthropic-messages", "anthropic"],
      ["gemini-3.6-flash", "google", "google-generative-ai", "google"],
      ["grok-4.5", "xai", "openai-responses", "xai"],
    ] as const;
    const rows = models.map(([modelId, provider]) => row({
      canonicalModelId: modelId,
      aliases: [`${provider}/${modelId}`],
    }));
    const payload = Object.fromEntries(models.map(([modelId, provider, api]) => [
      provider,
      { [modelId]: { id: modelId, api } },
    ]));

    const plan = planCatalogSync(rows, payload);

    expect(plan.changes).toHaveLength(4);
    for (const [modelId, , , format] of models) {
      expect(plan.changes.find((change) => change.canonicalModelId === modelId)?.operations)
        .toContainEqual({
          target: "capability",
          action: "set",
          key: "webSearchFormat",
          value: format,
        });
    }
  });

  it("不标记 API 不匹配或未列入白名单的型号", () => {
    const plan = planCatalogSync([
      row({
        canonicalModelId: "grok-4.3",
        aliases: ["xai/grok-4.3"],
        capabilities: { webSearchFormat: "xai" },
      }),
      row({
        canonicalModelId: "gpt-5.5",
        aliases: ["openai/gpt-5.5"],
        capabilities: { webSearchFormat: "openai" },
      }),
    ], {
      xai: { "grok-4.3": { id: "grok-4.3", api: "openai-completions" } },
      openai: { "gpt-5.5": { id: "gpt-5.5", api: "openai-completions" } },
    });

    for (const change of plan.changes) {
      expect(change.operations).toContainEqual({
        target: "capability",
        action: "delete",
        key: "webSearchFormat",
      });
    }
  });
});

describe("passesInvariants", () => {
  it("reasoning=false → 通过(不变量3)", () => {
    expect(passesInvariants(cap({ reasoning: false }))).toBe(true);
  });
  it("reasoning=true 有档 → 通过(不变量1/2)", () => {
    expect(passesInvariants(cap({ reasoning: true, thinkingLevelMap: { off: null, high: "high" } }))).toBe(true);
  });
  it("fixed 有多个开启档 → 拦截", () => {
    expect(passesInvariants(cap({
      reasoning: true,
      thinkingFormat: "fixed",
      thinkingLevelMap: { off: null, low: "low", high: "high" },
    }))).toBe(false);
  });
  it("fixed 没有开启档 → 拦截", () => {
    expect(passesInvariants(cap({
      reasoning: true,
      thinkingFormat: "fixed",
      thinkingLevelMap: { off: null },
    }))).toBe(false);
  });
  it("fixed 恰好一个开启档 → 通过", () => {
    expect(passesInvariants(cap({
      reasoning: true,
      thinkingFormat: "fixed",
      thinkingLevelMap: { off: null, high: "default" },
    }))).toBe(true);
  });
  it.each([
    { high: "default" },
    { off: "none", high: "default" },
  ])("fixed 的 off 缺失或非 null 时拦截: %o", (thinkingLevelMap) => {
    expect(passesInvariants(cap({
      reasoning: true,
      thinkingFormat: "fixed",
      thinkingLevelMap,
    }))).toBe(false);
  });
  it("reasoning=true 但全档被 null → 拦截", () => {
    expect(passesInvariants(cap({
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
    }))).toBe(false);
  });
});

describe("buildCatalogSyncSql", () => {
  it("只消费 accepted changes,使用定向 JSONB delete/patch 和幂等谓词", () => {
    const plan = planCatalogSync([
      row({
        canonicalModelId: "glm-5.2",
        aliases: ["zai/glm-5.2"],
        capabilities: { tools: true, vision: true },
      }),
      row({
        canonicalModelId: "kimi-k2",
        aliases: ["moonshotai/kimi-k2-0711-preview"],
        capabilities: {
          tools: true,
          reasoning: true,
          thinkingFormat: "deepseek",
          thinkingLevelMap: { high: "high" },
        },
      }),
      row({
        canonicalModelId: "reference-model",
        aliases: ["vendor/reference-model"],
        capabilities: { vision: true },
      }),
    ], {
      zai: { "glm-5.2": { id: "glm-5.2", input: ["text"] } },
      moonshotai: {
        "kimi-k2-0711-preview": { id: "kimi-k2-0711-preview", reasoning: false },
      },
      openrouter: {
        "vendor/reference-model": { id: "vendor/reference-model", input: ["text"] },
      },
    });

    const statements = buildCatalogSyncSql(plan);
    expect(statements).toHaveLength(2);
    expect(statements.join("\n")).not.toContain("reference-model");

    const glm = statements.find((statement) => statement.includes("'glm-5.2'"));
    expect(glm).toContain('"capabilities" - \'vision\'');
    expect(glm).toContain('"capabilities" IS DISTINCT FROM');
    expect(glm).toContain('"updated_at" = now()');
    expect(glm).not.toContain("INSERT INTO");

    const kimi = statements.find((statement) => statement.includes("'kimi-k2'"));
    for (const key of ["reasoning", "thinkingFormat", "thinkingLevelMap"]) {
      expect(kimi).toContain(`- '${key}'`);
    }
  });

  it("set capability 使用递归稳定 JSON patch,窗口列只在目标值不同时更新", () => {
    const plan = planCatalogSync([row({
      canonicalModelId: "image-model",
      aliases: ["vendor/image-model"],
      capabilities: { tools: true },
      contextWindow: 1000,
    })], {
      vendor: {
        "image-model": {
          id: "image-model",
          input: ["text", "image"],
          contextWindow: 2000,
        },
      },
    });
    const [statement] = buildCatalogSyncSql(plan);
    expect(statement).toContain(`|| '{"vision":true}'::jsonb`);
    expect(statement).toContain('"context_window" = 2000');
    expect(statement).toContain('"context_window" IS DISTINCT FROM 2000');
    expect(statement).toContain('"updated_at" = now()');
  });
});

describe("nextSyncMigrationSlot", () => {
  it("在 journal 末尾追加 idx/tag", () => {
    const slot = nextSyncMigrationSlot([
      { idx: 0, tag: "0000_baseline" },
      { idx: 8, tag: "0008_model_catalog_configured" },
    ]);
    expect(slot).toEqual({ idx: 9, tag: "0009_sync_pi_models" });
  });
});

describe("nextDataMigrationSnapshot", () => {
  it("保留 schema 并推进 snapshot id 链", () => {
    const previous = {
      id: "previous-id",
      prevId: "older-id",
      version: "7",
      dialect: "postgresql",
      tables: { "public.model_catalog": { name: "model_catalog" } },
    };

    const next = nextDataMigrationSnapshot(previous, "next-id");

    expect(next).toEqual({
      ...previous,
      id: "next-id",
      prevId: "previous-id",
    });
    expect(next).not.toBe(previous);
  });
});
