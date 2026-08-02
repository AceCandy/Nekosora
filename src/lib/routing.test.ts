/**
 * routing.ts 单测 —— 通过 setRouteRepository 注入内存 mock,验证路由决策逻辑。
 *
 * 覆盖:网关 owner-only 等价 + WebChat byId 可见性(public/owner/private-other)
 *      + 子 key 绑定过滤 + source 基于 visibility 推导 + 路由链结构。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  resolveRoutes,
  resolveRoutesById,
} from "@/lib/routing";
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
  supportsTools: boolean;
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
  /** keyId -> modelIds 绑定集。 */
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
      // 按 priority 升序(模拟 DB orderBy)。
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

/** 构造一套默认数据:owner=U_A 有一个 public 模型 + 一个 private 模型,各挂一条路由。 */
function makeDefaultData(): MockData {
  const providerA: MockProvider = {
    id: "PA", name: "上游A", protocol: "openai",
    baseUrl: "https://a.example.com/v1", apiKeysEnc: ENC_KEY, enabled: true,
  };
  const providerB: MockProvider = {
    id: "PB", name: "上游B", protocol: "openai",
    baseUrl: "https://b.example.com/v1", apiKeysEnc: ENC_KEY, enabled: true,
  };
  const pubModel: MockModel = {
    id: "M_PUB", name: "gpt-pub", ownerUserId: "U_A", visibility: "public",
    enabled: true, capabilities: { imageGeneration: true },
  };
  const privModel: MockModel = {
    id: "M_PRIV", name: "gpt-priv", ownerUserId: "U_A", visibility: "private",
    enabled: true, capabilities: {},
  };
  return {
    models: [pubModel, privModel],
    routes: [
      { id: "R_PUB", modelId: "M_PUB", providerId: "PA", upstreamModelName: "gpt-4o",
        priority: 0, weight: 1, supportsTools: true, enabled: true },
      { id: "R_PRIV", modelId: "M_PRIV", providerId: "PB", upstreamModelName: "gpt-4o-mini",
        priority: 0, weight: 1, supportsTools: false, enabled: true },
    ],
    providers: [providerA, providerB],
    bindings: new Map(),
  };
}

describe("routing", () => {
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

  // =========================================================================
  // resolveRoutes —— 网关 owner-only(by name)
  // =========================================================================
  describe("resolveRoutes (gateway owner-only)", () => {
    it("owner 自己的模型按名解析出路由链", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
      const routes = await resolveRoutes(ctx, "gpt-pub");
      expect(routes).toHaveLength(1);
      expect(routes[0].modelName).toBe("gpt-pub");
      expect(routes[0].upstreamModelName).toBe("gpt-4o");
      expect(routes[0].provider.id).toBe("PA");
      expect(routes[0].modelId).toBe("M_PUB");
      expect(routes[0].routeId).toBe("R_PUB");
    });

    it("网关只能调自己的模型:他人的模型 by name → model_not_found", async () => {
      // 把模型 owner 改成别人。
      data.models[0].ownerUserId = "U_B";
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
      await expect(resolveRoutes(ctx, "gpt-pub")).rejects.toMatchObject({
        code: "model_not_found",
      });
    });

    it("不存在的模型 → model_not_found", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
      await expect(resolveRoutes(ctx, "nope")).rejects.toMatchObject({
        code: "model_not_found",
      });
    });

    it("无可用路由 → no_route", async () => {
      data.routes = []; // 清空路由
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
      await expect(resolveRoutes(ctx, "gpt-pub")).rejects.toMatchObject({
        code: "no_route",
      });
    });
  });

  // =========================================================================
  // resolveRoutesById —— WebChat byId + 可见性
  // =========================================================================
  describe("resolveRoutesById (webchat visibility)", () => {
    it("public 模型:任意用户可调,source=global", async () => {
      const ctx: CallContext = { userId: "U_OTHER", keyKind: null, source: "chat" };
      const routes = await resolveRoutesById(ctx, "M_PUB");
      expect(routes).toHaveLength(1);
      expect(routes[0].source).toBe("global");
      expect(routes[0].modelId).toBe("M_PUB");
    });

    it("private 模型:owner 自己可调,source=byo", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "chat" };
      const routes = await resolveRoutesById(ctx, "M_PRIV");
      expect(routes).toHaveLength(1);
      expect(routes[0].source).toBe("byo");
      expect(routes[0].provider.id).toBe("PB");
    });

    it("private 模型:他人调 → model_not_found(不泄露存在性)", async () => {
      const ctx: CallContext = { userId: "U_OTHER", keyKind: null, source: "chat" };
      await expect(resolveRoutesById(ctx, "M_PRIV")).rejects.toMatchObject({
        code: "model_not_found",
      });
    });

    it("不存在的 modelId → model_not_found", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "chat" };
      await expect(resolveRoutesById(ctx, "M_NOPE")).rejects.toMatchObject({
        code: "model_not_found",
      });
    });
  });

  // =========================================================================
  // source 基于 visibility 推导
  // =========================================================================
  describe("source 推导", () => {
    it("public→global、private→byo", async () => {
      const ctxOwner: CallContext = { userId: "U_A", keyKind: null, source: "chat" };
      const pub = await resolveRoutesById(ctxOwner, "M_PUB");
      const priv = await resolveRoutesById(ctxOwner, "M_PRIV");
      expect(pub[0].source).toBe("global");
      expect(priv[0].source).toBe("byo");
    });
  });

  // =========================================================================
  // 子 key 绑定过滤
  // =========================================================================
  describe("子 key 绑定过滤", () => {
    it("绑定的模型可通过,未绑定的 → model_not_bound", async () => {
      data.bindings.set("KEY_SUB", new Set(["M_PUB"]));
      const ctx: CallContext = {
        userId: "U_A", apiKeyId: "KEY_SUB", keyKind: "sub", source: "gateway",
      };
      // 已绑定 → 通过
      const routes = await resolveRoutes(ctx, "gpt-pub");
      expect(routes).toHaveLength(1);
      // 未绑定(gpt-priv) → model_not_bound
      await expect(resolveRoutes(ctx, "gpt-priv")).rejects.toMatchObject({
        code: "model_not_bound",
      });
    });

    it("resolveRoutesById 同样校验子 key 绑定", async () => {
      data.bindings.set("KEY_SUB", new Set(["M_PUB"]));
      const ctx: CallContext = {
        userId: "U_A", apiKeyId: "KEY_SUB", keyKind: "sub", source: "chat",
      };
      await expect(resolveRoutesById(ctx, "M_PRIV")).rejects.toMatchObject({
        code: "model_not_bound",
      });
    });

    it("主 key / WebChat 无绑定限制", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "chat" };
      // 两个模型都能调
      await expect(resolveRoutesById(ctx, "M_PUB")).resolves.toHaveLength(1);
      await expect(resolveRoutesById(ctx, "M_PRIV")).resolves.toHaveLength(1);
    });
  });

  // =========================================================================
  // 路由链结构:priority 排序 + provider key 解密
  // =========================================================================
  describe("路由链结构", () => {
    it("多条路由按 priority 升序", async () => {
      // 给 pub 模型加一条低优先级路由。
      data.routes.push({
        id: "R_PUB2", modelId: "M_PUB", providerId: "PB",
        upstreamModelName: "gpt-4o-fallback", priority: 1, weight: 1,
        supportsTools: false, enabled: true,
      });
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
      const routes = await resolveRoutes(ctx, "gpt-pub");
      expect(routes).toHaveLength(2);
      expect(routes[0].priority).toBe(0);
      expect(routes[1].priority).toBe(1);
    });

    it("provider key 已解密", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "gateway" };
      const routes = await resolveRoutes(ctx, "gpt-pub");
      expect(routes[0].provider.apiKey).toBe("sk-test-fake");
      expect(routes[0].provider.keys).toHaveLength(1);
    });

    it("保留每条路由实际配置的工具能力", async () => {
      const ctx: CallContext = { userId: "U_A", keyKind: null, source: "chat" };

      await expect(resolveRoutesById(ctx, "M_PUB")).resolves.toEqual([
        expect.objectContaining({ routeId: "R_PUB", supportsTools: true }),
      ]);
      await expect(resolveRoutesById(ctx, "M_PRIV")).resolves.toEqual([
        expect.objectContaining({ routeId: "R_PRIV", supportsTools: false }),
      ]);
    });
  });
});
