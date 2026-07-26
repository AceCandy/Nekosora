import { describe, it, expect } from "vitest";
import {
  match, pickProvider, parsePiModelsApi, planCatalogSync, planMissingImports,
  canonicalFromPi, resolveThinkingFormat, resolveThinkingLevelMap, translate,
  passesInvariants, buildUpsert, buildImportUpsert, nextSyncMigrationSlot,
  type PiModel, type CatalogRow,
} from "./sync-pi-models";
import type { ModelCapabilities } from "@/db/types";

const pi = (over: Partial<PiModel> = {}): PiModel => ({ id: "x", ...over });
const cap = (o: Partial<ModelCapabilities>): ModelCapabilities => o as ModelCapabilities;

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
    expect(match("glm-5.2", ["zai/glm-5.2", "zhipu/glm-5.2"], PI)?.via).toBe("zai/glm-5.2");
  });
  it("bare 兜底:过滤区域变体取主 provider", () => {
    expect(match("kimi-k2", ["moonshot/kimi-k2", "kimi-k2-0711-preview"], PI)?.via)
      .toBe("moonshotai/kimi-k2-0711-preview");
  });
  it("聚合 provider 不抢占主 provider 命中(opencode 让位 zai)", () => {
    expect(match("glm-5.2", ["zai/glm-5.2"], PI)?.via).toBe("zai/glm-5.2");
  });
  it("全路径 key 命中(openrouter 的 openai/gpt-oss-120b)", () => {
    const m = match("gpt-oss-120b", ["openai/gpt-oss-120b"], PI);
    expect(m?.via).toBe("openrouter/openai/gpt-oss-120b");
    expect(m?.pi.maxTokens).toBe(131072);
  });
  it("nvidia 嵌套 key 可被 nvidia/ 前缀别名命中", () => {
    // 精确 provider/id: nvidia + nvidia/nemotron... 需要别名写成 nvidia/nvidia/...
    // 全路径 key 路径: 别名 nvidia/nemotron-3-nano-30b-a3b 在 nvidia provider 下作 key
    const m = match("nemotron-3-nano-30b-a3b", ["nvidia/nemotron-3-nano-30b-a3b"], PI);
    expect(m?.via).toBe("nvidia/nvidia/nemotron-3-nano-30b-a3b");
  });
  it("未匹配返回 null", () => {
    expect(match("nope", [], PI)).toBeNull();
  });
});

describe("pickProvider", () => {
  it("官方优先于聚合商", () => {
    expect(pickProvider(["openrouter", "google", "together"])).toBe("google");
  });
  it("仅聚合商时按 rank(openrouter 先于 together/huggingface)", () => {
    expect(pickProvider(["together", "openrouter", "huggingface"])).toBe("openrouter");
  });
});

describe("parsePiModelsApi", () => {
  it("解析 provider→model 结构并裁剪字段", () => {
    const PI = parsePiModelsApi({
      openai: {
        "gpt-5-chat-latest": {
          id: "gpt-5-chat-latest",
          name: "GPT-5 Chat Latest",
          reasoning: false,
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 16384,
          compat: { supportsReasoningEffort: false },
          cost: { input: 1 },
        },
      },
    });
    expect(PI.openai["gpt-5-chat-latest"].contextWindow).toBe(128000);
    expect(PI.openai["gpt-5-chat-latest"].maxTokens).toBe(16384);
    expect(PI.openai["gpt-5-chat-latest"].input).toEqual(["text", "image"]);
  });
  it("非法 payload 抛错", () => {
    expect(() => parsePiModelsApi([])).toThrow(/非法/);
  });
});

describe("planCatalogSync", () => {
  const PI = {
    openai: {
      "gpt-5-chat-latest": pi({
        id: "gpt-5-chat-latest",
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: ["text", "image"],
      }),
    },
  };

  it("对已有行产出 ctx/max 差异", () => {
    const rows: CatalogRow[] = [{
      canonicalModelId: "gpt-5-chat",
      name: "GPT-5 Chat",
      aliases: ["openai/gpt-5-chat-latest", "gpt-5-chat-latest"],
      capabilities: { tools: true, vision: true, systemPrompt: true },
      contextWindow: null,
      maxOutputTokens: null,
    }];
    const plan = planCatalogSync(rows, PI);
    expect(plan.matched).toBe(1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].ctxChange).toContain("128000");
    expect(plan.changes[0].maxChange).toContain("16384");
  });

  it("通用模板记入未匹配", () => {
    const plan = planCatalogSync([{
      canonicalModelId: "__generic_chat__",
      name: "通用",
      aliases: [],
      capabilities: {},
      contextWindow: null,
      maxOutputTokens: null,
    }], PI);
    expect(plan.unmatched).toContain("__generic_chat__");
    expect(plan.matched).toBe(0);
  });
});

describe("resolveThinkingFormat", () => {
  it("原生 anthropic/google 无 pi 重叠格式 → 保留现状", () => {
    expect(resolveThinkingFormat(cap({ thinkingFormat: "anthropic" }), pi({ compat: {} }))).toBe("anthropic");
    expect(resolveThinkingFormat(cap({ thinkingFormat: "google" }), pi({ compat: {} }))).toBe("google");
  });
  it("anthropic-adaptive → 保留", () => {
    expect(resolveThinkingFormat(cap({ thinkingFormat: "anthropic-adaptive" }), pi({ compat: {} })))
      .toBe("anthropic-adaptive");
  });
  it("fixed / agnes → 保留(pi 无对应)", () => {
    expect(resolveThinkingFormat(cap({ thinkingFormat: "fixed" }), pi({}))).toBe("fixed");
    expect(resolveThinkingFormat(cap({ thinkingFormat: "agnes" }), pi({}))).toBe("agnes");
  });
  it("pi 重叠格式 → 采用 pi 值", () => {
    expect(resolveThinkingFormat(cap({ thinkingFormat: "openai" }), pi({ compat: { thinkingFormat: "zai" } })))
      .toBe("zai");
  });
  it("openrouter 网关格式永不写入 catalog", () => {
    expect(resolveThinkingFormat(
      cap({ thinkingFormat: "openai" }),
      pi({ compat: { thinkingFormat: "openrouter" } }),
    )).toBe("openai");
    expect(resolveThinkingFormat(
      cap({}),
      pi({ compat: { thinkingFormat: "openrouter" } }),
    )).toBeUndefined();
  });
});

describe("resolveThinkingLevelMap", () => {
  it("fixed 目录保留 curated map,不采用 pi 的开关 map", () => {
    const currentMap = {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: "default",
      xhigh: null,
      max: null,
    };
    expect(resolveThinkingLevelMap(
      cap({ thinkingFormat: "fixed", thinkingLevelMap: currentMap }),
      pi({ compat: { thinkingFormat: "deepseek" }, thinkingLevelMap: { off: null } }),
    )).toEqual(currentMap);
  });

  it("openai-completions 系(pi 有 thinkingFormat)→ 用 pi map", () => {
    const piMap = { minimal: null, low: "high", medium: "high", high: "high", max: "max" };
    expect(resolveThinkingLevelMap(cap({ thinkingLevelMap: { high: null } }),
      pi({ compat: { thinkingFormat: "zai" }, thinkingLevelMap: piMap }))).toEqual(piMap);
  });
  it("原生 API(pi 无 thinkingFormat)→ 保现状,不刷", () => {
    const cur2 = { off: null, minimal: "MINIMAL", high: "HIGH" };
    expect(resolveThinkingLevelMap(cap({ thinkingLevelMap: cur2 }),
      pi({ compat: {}, thinkingLevelMap: { off: null } }))).toEqual(cur2);
  });
  it("pi 无 map → 规范化空串 high:\"\" → \"high\"", () => {
    expect(resolveThinkingLevelMap(cap({ thinkingLevelMap: { minimal: null, high: "" } }),
      pi({ compat: { thinkingFormat: "deepseek" } }))).toEqual({ minimal: null, high: "high" });
  });
  it("pi 无 map 且 cur 无 map → undefined", () => {
    expect(resolveThinkingLevelMap(cap({}), pi({ compat: { thinkingFormat: "deepseek" } }))).toBeUndefined();
  });
});

describe("translate", () => {
  it("vision 只升不降(pi 不含 image 保留 cur.vision)", () => {
    expect(translate(cap({ vision: true }), pi({ input: ["text"] })).vision).toBe(true);
  });
  it("vision 升(pi 含 image)", () => {
    expect(translate(cap({}), pi({ input: ["text", "image"] })).vision).toBe(true);
  });
  it("reasoning 只升不降(pi false 保留 cur)", () => {
    expect(translate(cap({ reasoning: true }), pi({ reasoning: false })).reasoning).toBe(true);
  });
  it("glm-5.2 端到端:low/medium→high、reasoningEffort=true", () => {
    const out = translate(
      cap({ reasoning: true, thinkingFormat: "zai", thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" } }),
      pi({ reasoning: true, compat: { thinkingFormat: "zai", supportsReasoningEffort: true }, thinkingLevelMap: { minimal: null, low: "high", medium: "high", high: "high", max: "max" }, input: ["text"] }),
    );
    expect(out.thinkingLevelMap).toEqual({ minimal: null, low: "high", medium: "high", high: "high", max: "max" });
    expect(out.reasoningEffort).toBe(true);
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
  it("reasoning=true 但全档被 null → 拦截", () => {
    expect(passesInvariants(cap({
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
    }))).toBe(false);
  });
});

describe("buildUpsert", () => {
  it("生成幂等 upsert,含 capabilities/ctx/max", () => {
    const sql = buildUpsert("glm-5.2", "GLM 5.2", cap({ reasoning: true }), 1000000, 131072);
    expect(sql).toContain("ON CONFLICT (\"canonical_model_id\") DO UPDATE SET");
    expect(sql).toContain("'glm-5.2'");
    expect(sql).toContain("\"context_window\" = 1000000");
    expect(sql).toContain("\"max_output_tokens\" = 131072");
  });
  it("ctx/max 为 null 时不下发", () => {
    const sql = buildUpsert("x", "X", cap({}), null, null);
    expect(sql).not.toContain("context_window");
    expect(sql).not.toContain("max_output_tokens");
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

describe("canonicalFromPi / planMissingImports", () => {
  it("去掉 org 前缀与 :free", () => {
    expect(canonicalFromPi("openai/gpt-oss-20b:free", pi({ id: "openai/gpt-oss-20b:free" })))
      .toBe("gpt-oss-20b");
  });

  it("已有 catalog 跳过,缺失则导入并合并 aliases", () => {
    const PI = {
      google: {
        "gemma-4-31b-it": pi({
          id: "gemma-4-31b-it",
          name: "Gemma 4 31B IT",
          contextWindow: 262144,
          maxTokens: 32768,
          reasoning: true,
          input: ["text", "image"],
        }),
      },
      openrouter: {
        "google/gemma-4-31b-it:free": pi({
          id: "google/gemma-4-31b-it:free",
          name: "Gemma free",
          contextWindow: 131072,
          maxTokens: 8192,
          reasoning: true,
          input: ["text", "image"],
        }),
        "brand-new-model-xyz": pi({
          id: "brand-new-model-xyz",
          name: "Brand New",
          contextWindow: 64000,
          maxTokens: 4096,
          reasoning: false,
          input: ["text"],
        }),
      },
    };
    const rows: CatalogRow[] = [{
      canonicalModelId: "gemma-4-31b",
      name: "Gemma 4 31B",
      aliases: ["gemma-4-31b-it", "google/gemma-4-31b-it"],
      capabilities: { tools: true },
      contextWindow: 262144,
      maxOutputTokens: 32768,
    }];
    const plan = planMissingImports(rows, PI);
    expect(plan.skippedExisting).toBeGreaterThanOrEqual(1);
    expect(plan.imports.some((i) => i.canonicalModelId === "gemma-4-31b-it" || i.canonicalModelId === "gemma-4-31b"))
      .toBe(false);
    const neu = plan.imports.find((i) => i.canonicalModelId === "brand-new-model-xyz");
    expect(neu).toBeTruthy();
    expect(neu?.contextWindow).toBe(64000);
    expect(neu?.maxOutputTokens).toBe(4096);
  });
});

describe("buildImportUpsert", () => {
  it("含 aliases 与窗口字段", () => {
    const sql = buildImportUpsert(
      "foo-1",
      "Foo 1",
      ["provider/foo-1"],
      cap({ tools: true }),
      1000,
      200,
      2100,
    );
    expect(sql).toContain("\"aliases\"");
    expect(sql).toContain("\"context_window\"");
    expect(sql).toContain("1000");
    expect(sql).toContain("200");
    expect(sql).toContain("ON CONFLICT");
  });
});
