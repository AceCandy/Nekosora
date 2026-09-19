/**
 * 图像生成适配器 —— P1-D。
 *
 * WebChat 按 modelId 解析可见路由，网关按模型名解析 owner-only 路由。
 * 目录出图方式决定使用 Images 接口或 Responses 绘图工具。
 *
 * response_format:
 *   - b64_json:直接返回 base64(默认)
 *   - url:存到 StorageDriver(P2-A),返回公网/签名 URL
 *
 * 超时、取消与故障转移复用网关执行引擎。
 */
import { generateImage, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { CallContext } from "../types";
import { resolveRoutes, resolveRoutesById, RoutingError } from "../../routing";
import { gatewayBreaker } from "../../circuit-breaker";
import {
  executeAtomicGateway,
  gatewayTelemetry,
  type GatewayAttemptAdapter,
} from "../../gateway-execution/index";
import { selectMediaAdapter } from "../../gateway-execution/media-registry";
import { createProviderFetch } from "../timeouts";
import { getImageGenerationSettings } from "../../model-catalog";
import { ErrorCode } from "../../errors";

export interface ImageGenOptions {
  prompt: string;
  n?: number; // 生成数量(默认 1)
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792" | "1024x1536" | "1536x1024";
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
  /** 命中服务商。 */
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
    if (getImageGenerationSettings(route.capabilities).format === "openai-responses") {
      const size = opts.size;
      if (size && size !== "1024x1024" && size !== "1024x1536" && size !== "1536x1024") {
        throw new Error("invalid_request: Responses 不支持该图片尺寸");
      }
      const result = await generateText({
        model: provider.responses(route.upstreamModelName),
        prompt: opts.prompt,
        tools: { imageGeneration: provider.tools.imageGeneration({ outputFormat: "png", size }) },
        toolChoice: { type: "tool", toolName: "imageGeneration" },
        maxRetries: 0,
        abortSignal,
      });
      const images = result.toolResults.flatMap((tool) =>
        !tool.dynamic && tool.toolName === "imageGeneration" && tool.output.result
          ? [{ base64: tool.output.result }] : [],
      );
      if (!images.length) throw new Error("图像生成未返回图片");
      return { value: images, usage: {
        imageCount: images.length,
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
        totalTokens: result.totalUsage.totalTokens,
      } };
    }
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
    if (!images.length) throw new Error("图像生成未返回图片");
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
    selectAdapter: (route) => {
      const settings = getImageGenerationSettings(route.capabilities);
      if (settings.format === "openai-responses") {
        if (!["openai", "openai-compatible"].includes(route.protocol)) return null;
        if (route.capabilities?.tools !== true || route.supportsTools !== true) {
          return { kind: "rejected", error: {
            code: "capability_not_supported", phase: "routing",
            message: "Responses 绘图要求模型目录及路由均启用工具调用",
          } };
        }
        if ((opts.n ?? 1) !== 1 || (opts.size && !settings.sizes.some((size) => size === opts.size))) {
          return { kind: "rejected", error: {
            code: ErrorCode.REQUEST_UNSUPPORTED_PARAMETER, phase: "request", httpStatus: 400,
            message: "Responses 绘图仅支持单张及 1024x1024、1024x1536、1536x1024 尺寸",
          } };
        }
      }
      return selectMediaAdapter("image.generate", route.protocol, adapter);
    },
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
