import type { IRRequest } from "@/lib/providers/types";

/** 对外网关支持的四种调用协议。 */
export type GatewayProtocol = "openai-chat" | "openai-responses" | "anthropic" | "gemini";

/** parser 输出；后续统一进入 streamChat 执行链。 */
export interface ParsedGatewayRequest {
  protocol: GatewayProtocol;
  request: IRRequest;
  stream: boolean;
}
