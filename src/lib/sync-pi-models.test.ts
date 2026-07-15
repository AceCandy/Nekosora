import { describe, it, expect } from "vitest";
import {
  match, resolveThinkingFormat, resolveThinkingLevelMap, translate,
  passesInvariants, buildUpsert, type PiModel,
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
  } as unknown as Record<string, Record<string, PiModel>>;

  it("精确 provider/id 命中", () => {
    expect(match("glm-5.2", ["zai/glm-5.2", "zhipu/glm-5.2"], PI)?.via).toBe("zai/glm-5.2");
  });
  it("bare 兜底:过滤区域变体取主 provider", () => {
    expect(match("kimi-k2", ["moonshot/kimi-k2", "kimi-k2-0711-preview"], PI)?.via)
      .toBe("moonshotai/kimi-k2-0711-preview");
  });
  it("聚合 provider 不抢占主 provider 命中(opencode 让位 zai)", () => {
    // glm-5.2 同时在 zai 与 opencode,精确匹配 zai 优先
    expect(match("glm-5.2", ["zai/glm-5.2"], PI)?.via).toBe("zai/glm-5.2");
  });
  it("未匹配返回 null", () => {
    expect(match("nope", [], PI)).toBeNull();
  });
});

describe("resolveThinkingFormat", () => {
  it("claude 非 adaptive → 去标识", () => {
    expect(resolveThinkingFormat(cap({ thinkingFormat: "anthropic" }), pi({ compat: {} }))).toBeUndefined();
  });
  it("gemini google → 去标识", () => {
    expect(resolveThinkingFormat(cap({ thinkingFormat: "google" }), pi({ compat: {} }))).toBeUndefined();
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
});

describe("resolveThinkingLevelMap", () => {
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
