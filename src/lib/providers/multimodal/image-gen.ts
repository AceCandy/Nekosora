/**
 * 图像生成适配器 —— P1-D。
 *
 * 复用四表路由器(resolveRoutesByCapability 拿路由链),调用 AI SDK v5 的 generateImage。
 * OpenAI Images API 兼容(DALL-E / gpt-image-1);其他 OpenAI 兼容上游同理。
 *
 * response_format:
 *   - b64_json:直接返回 base64(默认)
 *   - url:存到 StorageDriver(P2-A),返回公网/签名 URL
 *
 * 故障转移:逐条路由尝试,首条失败抛出(图像生成多为单次调用,不做 key 级重试)。
 */
import { experimental_generateImage as generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { CallContext, ResolvedRoute } from "@/lib/providers/types";
import { resolveRoutesByCapability, RoutingError } from "@/lib/routing";

export interface ImageGenOptions {
  prompt: string;
  n?: number; // 生成数量(默认 1)
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
  responseFormat?: "b64_json" | "url";
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
  /** 图像生成无 token 计费概念,usage 为空(计费按张,后续 Billing 补)。 */
  providerRef?: string;
}

/**
 * 通过路由链生成图像。
 * @throws RoutingError(capability_not_supported / no_route / model_not_found)
 */
export async function generateImageViaRoute(
  ctx: CallContext,
  modelName: string,
  opts: ImageGenOptions,
): Promise<ImageGenResult> {
  const routes = await resolveRoutesByCapability(ctx, modelName, "imageGeneration");
  const route = routes[0];
  const { baseURL, apiKey, headers } = buildOpenAICompatConfig(route);

  // 图像生成用 @ai-sdk/openai 的 image 模型(指向任意 OpenAI 兼容 baseURL)。
  const provider = createOpenAI({ baseURL, apiKey, name: route.provider.id, headers });
  const model = provider.image(route.upstreamModelName);

  const result = await generateImage({
    model,
    prompt: opts.prompt,
    n: opts.n ?? 1,
    // AI SDK v5 size 透传(providerOptions)。
    providerOptions: opts.size ? { openai: { size: opts.size } } : undefined,
  });

  const images: GeneratedImage[] = [];
  for (const img of result.images) {
    // AI SDK v5 的 GeneratedFile 含 base64(string)与 uint8Array。
    // base64 优先;为空时用 uint8Array 转 base64 兜底。
    if (img.base64) {
      images.push({ base64: img.base64 });
    } else if (img.uint8Array) {
      images.push({ base64: Buffer.from(img.uint8Array).toString("base64") });
    }
  }

  return { images, providerRef: `${route.source}:${route.provider.id}` };
}

/** 从 ResolvedRoute 提取 OpenAI 兼容配置。 */
function buildOpenAICompatConfig(route: ResolvedRoute): {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
} {
  return {
    baseURL: route.provider.baseUrl,
    apiKey: route.provider.apiKey,
    headers: route.provider.headers,
  };
}

export { RoutingError };
