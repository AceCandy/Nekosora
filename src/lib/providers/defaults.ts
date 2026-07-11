/**
 * 各 provider 协议的默认接口地址矩阵。
 *
 * 供 ProviderFormDialog 在选择协议后自动填充默认 baseUrl、展示
 * "解析后实际请求地址"预览,降低新手填错(如 OpenAI 忘加 /v1)的概率。
 *
 * 仅对主流协议(openai/anthropic/gemini/openai-compatible)提供默认值;
 * 音频/图像类协议配置场景少,留空让用户自填。
 *
 * 借鉴 AQBot 的 DEFAULT_HOSTS / DEFAULT_PATHS 设计。
 */
import type { ProviderProtocol } from "@/db/types";

/** 各协议的默认 host(不含路径,不含末尾斜杠)。 */
export const DEFAULT_HOSTS: Partial<Record<ProviderProtocol, string>> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  "openai-compatible": "",
};

/** 各协议的默认模型列表端点路径(拼在 host 后拉取 /models)。 */
export const DEFAULT_MODELS_PATH: Partial<Record<ProviderProtocol, string>> = {
  openai: "/models",
  anthropic: "/models",
  gemini: "/models",
  "openai-compatible": "/models",
};

/**
 * 解析出该协议下"拉取模型列表"的实际请求地址(预览用)。
 * baseUrl 已含版本前缀(如 /v1),直接拼路径即可。
 */
export function resolveModelsUrl(protocol: ProviderProtocol, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = DEFAULT_MODELS_PATH[protocol] ?? "/models";
  return `${base}${path}`;
}

/**
 * 规范化 provider 接口地址:openai-compatible 协议下若缺少版本前缀,
 * 在保存时自动补 /v1;其他协议原样返回。
 *
 * 用户填 openai-compatible 上游时常漏 /v1,导致 /models、/chat/completions
 * 落到错误路径。保存瞬间补全,列表/详情展示的就是入库后的最终地址。
 */
export function normalizeBaseUrl(protocol: ProviderProtocol, baseUrl: string): string {
  if (protocol !== "openai-compatible") return baseUrl;
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}
