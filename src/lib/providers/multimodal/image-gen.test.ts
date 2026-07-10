/**
 * image-gen 单测 —— 验证 WebChat byId 路由解析 + 可见性(回归守护)。
 *
 * 回归背景:统一资源模型改造把网关改成 owner-only 后,图像工作室(WebChat 语义)
 * 仍走 resolveRoutes(owner-only),导致普通用户选 admin 发布的 public 图像模型时
 * model_not_found。修复后 WebChat 传 modelId 走 resolveRoutesById(public ∪ owner 可见)。
 *
 * 通过 setRouteRepository 注入内存 mock(复用 routing.test.ts 的数据形态),
 * 并 mock 掉 AI SDK(generateImage / createOpenAI),隔离真实上游调用。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// Mock AI SDK(vi.mock 自动提升到文件顶部;factory 仅用 vi.fn 与字面量,不引用外部变量)。
vi.mock("ai", () => ({
  generateImage: vi.fn().mockResolvedValue({
    images: [{ base64: "ZmFrZQ==" }], // "fake" 的 base64
  }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn().mockReturnValue({
    image: vi.fn().mockReturnValue({ modelId: "mock-image-model" }),
  }),
}));

import { generateImageViaRoute, RoutingError } from "@/lib/providers/multimodal/image-gen";
import {
  setRouteRepository,
  resetRouteRepository,
  type RouteRepository,
} from "@/lib/repositories/route-repository";
import { encrypt } from "@/lib/infra/crypto";
import type { CallContext } from "@/lib/providers/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const ENC_KEY_PLAIN = JSON.stringify({ keys: [{ key: "sk-test-fake", weight: 1 }] });
let ENC_KEY = "";

interface MockModel {
  id: string;
  name: string;
  ownerUserId: string;
  visibility: "public" | "private";
  enabled: boolean;
  capabilities?: Record<string, boolean>;
}
interface MockRoute {
  id: string;
  modelId: string;
  providerId: string;
  upstreamModelName: string;
  priority: number;
  weight: number;
  enabled: boolean;
}
interface MockProvider {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKeysEnc: string;
  enabled: boolean;
}

interface MockData {
  models: MockModel[];
  routes: MockRoute[];
  providers: MockProvider[];
  bindings: Map<string, Set<string>>;
}

function makeMockRepo(data: MockData): RouteRepository {
  return {
    findEnabledModelById: async (modelId) =>
      (data.models.find((m) => m.id === modelId && m.enabled) as Row) ?? null,
    findEnabledModelByNameForOwner: async (modelName, userId) =>
      (data.models.find(
        (m) => m.name === modelName && m.ownerUserId === userId && m.enabled,
      ) as Row) ?? null,
    findEnabledRoutes: async (modelId) => {
      const out: Array<{ route: Row; provider: Row }> = [];
      for (const r of data.routes) {
        if (r.modelId !== modelId || !r.enabled) continue;
        const p = data.providers.find((pp) => pp.id === r.providerId && pp.enabled);
        if (!p) continue;
        out.push({ route: r as Row, provider: p as Row });
      }
      out.sort((a, b) => a.route.priority - b.route.priority);
      return out;
    },
    findEnabledProvider: async (providerId) =>
      (data.providers.find((p) => p.id === providerId && p.enabled) as Row) ?? null,
    findKeyModelBindings: async (keyId) => ({
      modelIds: new Set(data.bindings.get(keyId) ?? new Set<string>()),
    }),
  };
}

/** 默认数据:U_A 拥有一个 public 图像模型 + 一个 private 图像模型,各挂一条路由。 */
function makeDefaultData(): MockData {
  const provider: MockProvider = {
    id: "PA", name: "上游A", protocol: "openai",
    baseUrl: "https://a.example.com/v1", apiKeysEnc: ENC_KEY, enabled: true,
  };
  const pubModel: MockModel = {
    id: "M_PUB", name: "dalle-pub", ownerUserId: "U_A", visibility: "public",
    enabled: true, capabilities: { imageGeneration: true },
  };
  const privModel: MockModel = {
    id: "M_PRIV", name: "dalle-priv", ownerUserId: "U_A", visibility: "private",
    enabled: true, capabilities: { imageGeneration: true },
  };
  return {
    models: [pubModel, privModel],
    routes: [
      { id: "R_PUB", modelId: "M_PUB", providerId: "PA", upstreamModelName: "dall-e-3",
        priority: 0, weight: 1, enabled: true },
      { id: "R_PRIV", modelId: "M_PRIV", providerId: "PA", upstreamModelName: "dall-e-3",
        priority: 0, weight: 1, enabled: true },
    ],
    providers: [provider],
    bindings: new Map(),
  };
}

describe("generateImageViaRoute (image byId 可见性)", () => {
  let data: MockData;

  beforeAll(() => {
    // crypto 模块懒读取此环境变量(parseKeyBundle → decrypt)。
    process.env.DATA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    ENC_KEY = encrypt(ENC_KEY_PLAIN);
  });

  beforeEach(() => {
    data = makeDefaultData();
    setRouteRepository(makeMockRepo(data));
  });

  afterEach(() => {
    resetRouteRepository();
  });

  it("WebChat byId:非 owner 用户可生成 public 图像模型(回归守护)", async () => {
    // 回归场景:普通用户 U_OTHER 选 admin(U_A)发布的 public 图像模型。
    // 旧实现走 resolveRoutes(owner-only)→ model_not_found;修复后走 resolveRoutesById → 通过。
    const ctx: CallContext = { userId: "U_OTHER", keyKind: null, source: "chat" };
    const result = await generateImageViaRoute(
      ctx, "dalle-pub", { prompt: "一只猫" }, "M_PUB",
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0].base64).toBe("ZmFrZQ==");
    expect(result.providerName).toBe("上游A");
    expect(result.upstreamModel).toBe("dall-e-3");
  });

  it("WebChat byId:owner 自己可生成 private 图像模型", async () => {
    const ctx: CallContext = { userId: "U_A", keyKind: null, source: "chat" };
    const result = await generateImageViaRoute(
      ctx, "dalle-priv", { prompt: "一只猫" }, "M_PRIV",
    );
    expect(result.images).toHaveLength(1);
  });

  it("WebChat byId:非 owner 调他人 private 图像模型 → model_not_found", async () => {
    const ctx: CallContext = { userId: "U_OTHER", keyKind: null, source: "chat" };
    await expect(
      generateImageViaRoute(ctx, "dalle-priv", { prompt: "一只猫" }, "M_PRIV"),
    ).rejects.toMatchObject({ code: "model_not_found" });
  });

  it("网关语义(无 modelId):非 owner 调 public 模型 → model_not_found(owner-only)", async () => {
    // 网关端点 /v1/images/generations 不传 modelId,走 resolveRoutes(owner-only),
    // public 对网关不可见。这是正确的网关语义,保持不动。
    const ctx: CallContext = { userId: "U_OTHER", keyKind: null, source: "gateway" };
    await expect(
      generateImageViaRoute(ctx, "dalle-pub", { prompt: "一只猫" }),
    ).rejects.toMatchObject({ code: "model_not_found" });
  });

  it("网关语义(无 modelId):owner 自己可调 public 图像模型", async () => {
    const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
    const result = await generateImageViaRoute(ctx, "dalle-pub", { prompt: "一只猫" });
    expect(result.images).toHaveLength(1);
  });

  it("byId:模型无 imageGeneration 能力 → capability_not_supported", async () => {
    data.models[0].capabilities = {}; // 去掉 imageGeneration
    const ctx: CallContext = { userId: "U_OTHER", keyKind: null, source: "chat" };
    await expect(
      generateImageViaRoute(ctx, "dalle-pub", { prompt: "一只猫" }, "M_PUB"),
    ).rejects.toMatchObject({ code: "capability_not_supported" });
  });

  it("RoutingError 仍被导出(调用方依赖此类型)", () => {
    expect(RoutingError).toBeInstanceOf(Function);
  });
});
