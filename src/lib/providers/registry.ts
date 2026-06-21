/**
 * Provider 注册表 —— 把 ResolvedRoute(解密后的上游配置)转成 AI SDK LanguageModel。
 *
 * AI SDK v5:
 *   openai/custom → createOpenAICompatible({ baseURL, apiKey, name }).chatModel(model)
 *   anthropic     → createAnthropic({ baseURL, apiKey }).chat(model)
 *   gemini        → createGoogleGenerativeAI({ baseURL, apiKey })(model)
 *
 * 每次请求新建 provider 实例(因为 baseURL/apiKey 来自 DB,每条路由可能不同)。
 * AI SDK 的 provider 构造很轻,无连接池开销。
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ResolvedRoute } from "./types";
import type { ProviderProtocol } from "@/db/types";

/** 从 ResolvedRoute 构造 AI SDK LanguageModel(V2,兼容 ai@5)。 */
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
    case "openai":
    case "custom": {
      // @ai-sdk/openai 的 createOpenAI 可指向任意 baseURL,覆盖 OpenAI 官方、
      // OpenRouter、自部署 vLLM、Ollama 等所有 OpenAI 兼容上游。
      const providerInstance = createOpenAI({
        baseURL: baseUrl,
        apiKey,
        name: provider.id,
        headers: commonHeaders,
      });
      return providerInstance.chat(upstreamModelName);
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
      const providerInstance = createGoogleGenerativeAI({
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
