import type { ProviderProtocol } from "@/db/types";

/**
 * 服务商协议可选项(供 ProviderFormDialog 的 select 使用)。
 * admin / panel 两处 page.tsx 共享,避免重复定义。
 */
export const PROVIDER_PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
  { value: "openai", label: "openai" },
  { value: "anthropic", label: "anthropic" },
  { value: "gemini", label: "gemini" },
  { value: "openai-compatible", label: "openai-compatible" },
];
