/**
 * Provider 注册表 —— 把 ResolvedRoute(解密后的上游配置)转成 AI SDK LanguageModel。
 *
 * AI SDK V4(ai@7):
 *   openai            → createOpenAI({ baseURL, apiKey }).chat(model)
 *   openai-compatible → createOpenAICompatible({ baseURL, apiKey }).chatModel(model)
 *   anthropic         → createAnthropic({ baseURL, apiKey }).chat(model)
 *   gemini            → createGoogle({ baseURL, apiKey })(model)
 *
 * 每次请求新建 provider 实例(因为 baseURL/apiKey 来自 DB,每条路由可能不同)。
 * AI SDK 的 provider 构造很轻,无连接池开销。
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ResolvedRoute } from "./types";
import type { ProviderProtocol } from "@/db/types";

/** 从 ResolvedRoute 构造 AI SDK LanguageModel(V4,兼容 ai@7)。 */
export function buildLanguageModel(route: ResolvedRoute): LanguageModel {
  return buildLanguageModelWithKey(route, route.provider.apiKey);
}

/** 用指定 api key 构造 LanguageModel(stream.ts 换 key 重试时调用)。 */
export function buildLanguageModelWithKey(
  route: ResolvedRoute,
  apiKey: string,
): LanguageModel {
  const { protocol, provider, upstreamModelName } = route;
  const { baseUrl, headers } = provider;

  const commonHeaders = headers ?? {};

  switch (protocol as ProviderProtocol) {
    case "openai": {
      // OpenAI 官方:createOpenAI 对 reasoning 模型(o1/o3/gpt-5 等)会把 system
      // 消息发成 developer role,这是官方约定,官方上游接受。
      const providerInstance = createOpenAI({
        baseURL: baseUrl,
        apiKey,
        name: provider.id,
        headers: commonHeaders,
      });
      return providerInstance.chat(upstreamModelName);
    }
    case "openai-compatible": {
      // 第三方 OpenAI 兼容上游(SiliconFlow/DeepSeek/Qwen/自建 vLLM 等):
      // 用 compatible provider,system 消息保持 role:"system",避免被转成
      // developer role 而被这些上游以 400 拒收。
      const providerInstance = createOpenAICompatible({
        name: provider.id,
        baseURL: baseUrl,
        apiKey,
        headers: commonHeaders,
        // 显式要求流式响应在末尾返回 usage。部分 OpenAI 兼容上游严格遵循规范,
        // 仅当请求带 stream_options.include_usage 时才返回 token 计数,
        // 否则流式不返回 usage,导致用量统计为 0。
        includeUsage: true,
      });
      return providerInstance.chatModel(upstreamModelName);
    }
    case "anthropic": {
      const providerInstance = createAnthropic({
        baseURL: baseUrl,
        apiKey,
        headers: commonHeaders,
      });
      return providerInstance.chat(upstreamModelName);
    }
    case "gemini": {
      const providerInstance = createGoogle({
        baseURL: baseUrl,
        apiKey,
        headers: commonHeaders,
      });
      return providerInstance(upstreamModelName);
    }
    default:
      throw new Error(`不支持的 provider 协议:${protocol}`);
  }
}
