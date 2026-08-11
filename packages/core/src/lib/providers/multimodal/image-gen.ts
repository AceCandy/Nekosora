/**
 * 图像生成适配器 —— P1-D。
 *
 * 复用路由器拿路由链:WebChat 传 modelId 走 resolveRoutesById(public ∪ owner 可见),
 * 网关缺省 modelId 走 resolveRoutes(owner-only);再调 AI SDK v5 的 generateImage。
 * OpenAI Images API 兼容(DALL-E / gpt-image-1);其他 OpenAI 兼容上游同理。
 *
 * response_format:
 *   - b64_json:直接返回 base64(默认)
 *   - url:存到 StorageDriver(P2-A),返回公网/签名 URL
 *
 * 故障转移:逐条路由尝试,首条失败抛出(图像生成多为单次调用,不做 key 级重试)。
 */
import { generateImage as generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { CallContext } from "@/lib/providers/types";
import { resolveRoutes, resolveRoutesById, RoutingError } from "@/lib/routing";
import { gatewayBreaker } from "@/lib/circuit-breaker";
import {
  executeAtomicGateway,
  gatewayTelemetry,
  type GatewayAttemptAdapter,
} from "@/lib/gateway-execution";
import { selectMediaAdapter } from "@/lib/gateway-execution/media-registry";
import { createProviderFetch } from "@/lib/providers/timeouts";

export interface ImageGenOptions {
  prompt: string;
  n?: number; // 生成数量(默认 1)
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
  responseFormat?: "b64_json" | "url";
  abortSignal?: AbortSignal;
  onProviderStart?: () => Promise<void>;
}

export interface GeneratedImage {
  /** base64(无 data: 前缀)或 null(走 url 时)。 */
  base64?: string;
  /** 公网/签名 URL(b64 模式为 null)。 */
  url?: string;
  revisedPrompt?: string;
}

export interface ImageGenResult {
  images: GeneratedImage[];
  /** 图像生成无 token 计费概念，执行用量按实际返回张数记录。 */
  providerRef?: string;
  /** 可读服务商名快照(用量日志展示)。 */
  providerName?: string;
  /** 命中路由 id 溯源。 */
  routeId?: string;
  /** 组合路由展示名(providerName · upstreamModelName)。 */
  routeName?: string;
  /** 真实上游模型名。 */
  upstreamModel?: string;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *)。 */
  upstreamKeyMasked?: string | null;
}

/**
 * 通过路由链生成图像。
 *
 * @param modelId 模型 id。WebChat 传 → 走 resolveRoutesById(public ∪ owner 可见,避免 public/private 同名歧义);
 *               网关缺省 → 走 resolveRoutes(by name,owner-only)。
 * @throws RoutingError(capability_not_supported / no_route / model_not_found)
 */
export async function generateImageViaRoute(
  ctx: CallContext,
  modelName: string,
  opts: ImageGenOptions,
  modelId?: string,
): Promise<ImageGenResult> {
  const adapter: GatewayAttemptAdapter<never, GeneratedImage[]> = async function* ({ route, apiKey, abortSignal }) {
    const provider = createOpenAI({
      baseURL: route.provider.baseUrl,
      apiKey,
      name: route.provider.id,
      headers: route.provider.headers,
      fetch: createProviderFetch({ connectTimeoutMs: route.provider.connectTimeoutMs }),
    });
    const result = await generateImage({
      model: provider.image(route.upstreamModelName),
      prompt: opts.prompt,
      n: opts.n ?? 1,
      providerOptions: opts.size ? { openai: { size: opts.size } } : undefined,
      abortSignal,
    });
    const images = result.images.flatMap((image) => {
      if (image.base64) return [{ base64: image.base64 }];
      if (image.uint8Array) {
        return [{ base64: Buffer.from(image.uint8Array).toString("base64") }];
      }
      return [];
    });
    return { value: images, usage: { imageCount: images.length } };
  };
  const outcome = await executeAtomicGateway({
    ctx,
    requestId: `img_${crypto.randomUUID()}`,
    operation: "image.generate",
    model: modelName,
    modelId,
    requestPath: "/v1/images/generations",
    abortSignal: opts.abortSignal,
    resolveRoutes: async () => {
      const routes = modelId
        ? await resolveRoutesById(ctx, modelId)
        : await resolveRoutes(ctx, modelName);
      if (!routes[0]?.capabilities?.imageGeneration) {
        throw new RoutingError(
          "capability_not_supported",
          `模型 ${modelName} 不支持能力 imageGeneration`,
        );
      }
      return routes;
    },
    selectAdapter: (route) => selectMediaAdapter("image.generate", route.protocol, adapter),
    onProviderStart: opts.onProviderStart,
    telemetry: gatewayTelemetry,
    breaker: gatewayBreaker,
  });
  if (outcome.status !== "success" || !outcome.result || !outcome.route) {
    throwExecutionError(outcome.error?.code, outcome.error?.message, outcome.error?.phase);
  }
  return {
    images: outcome.result,
    providerRef: `${outcome.route.source}:${outcome.route.provider.id}`,
    providerName: outcome.route.provider.name,
    routeId: outcome.route.routeId,
    routeName: `${outcome.route.provider.name} · ${outcome.route.upstreamModelName}`,
    upstreamModel: outcome.route.upstreamModelName,
    upstreamKeyMasked: outcome.upstreamKeyMasked ?? null,
  };
}

function throwExecutionError(code?: string, message?: string, phase?: string): never {
  if (phase === "routing" || phase === "request") {
    throw new RoutingError(code ?? "routing_error", message ?? "图像生成路由失败");
  }
  throw new Error(message ?? "图像生成失败");
}

export { RoutingError };
