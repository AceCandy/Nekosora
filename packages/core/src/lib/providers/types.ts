/**
 * Provider 适配层统一类型 —— 以 OpenAI Chat Completions 格式作为 IR(中间表示)。
 *
 * 设计:WebChat 和对外网关都产出/消费 IR,Provider 适配器负责把 IR 翻译成
 * 各上游协议(OpenAI/Anthropic/Gemini)的请求、把响应翻回 IR。
 *
 * 加新 provider 协议 = 写一个 adapter,Chat 和网关同时受益。
 */
import type {
  ProviderProtocol,
  RouteApiFormat,
  ModelCapabilities,
  ReasoningLevel,
} from "@/db/types";
import type { WeightedKey } from "./keys";

/** 上游 provider 的运行时配置(从数据库解密后得到)。 */
export interface ResolvedProvider {
  id: string;
  /** 可读名称(用于日志快照,provider 改名不影响历史行)。 */
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  /** 本轮选中的 api key(仅运行时持有,不落库、不打日志)。 */
  apiKey: string;
  /** 该 provider 的全部加权 key(用于同 provider 内 key 故障转移)。 */
  keys: WeightedKey[];
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  headers?: Record<string, string>;
}

/** 一条路由解析结果:对应一个具体可调用的上游模型。 */
export interface ResolvedRoute {
  /** 对外模型名(用户/调用方传入的)。 */
  modelName: string;
  /** 上游实际模型名。 */
  upstreamModelName: string;
  /** 具体 route 使用的上游 wire protocol；真实数据库 route 始终提供。 */
  apiFormat?: RouteApiFormat;
  /** Provider 连接类型，保留给默认值、兼容 Chat 与媒体 adapter 使用。 */
  protocol: ProviderProtocol;
  provider: ResolvedProvider;
  /** route 级自定义 headers，优先于 Provider headers，但不能覆盖认证头。 */
  headers?: Record<string, string>;
  /** 该路由的优先级(用于分组);weight 用于组内加权。 */
  priority: number;
  weight: number;
  /** 来源标记,便于用量归属与日志。语义基于模型 visibility:public→"global"、private→"byo"。 */
  source: "global" | "byo";
  /** 命中的路由 id(用量/错误日志溯源)。 */
  routeId: string;
  /** 命中的模型 id(用量记录用)。 */
  modelId?: string;
  capabilities?: ModelCapabilities;
  /** 当前上游路由是否已验证支持工具调用。 */
  supportsTools?: boolean;
}

/**
 * 调用身份上下文 —— streamChat 和 routing 都需要它来解析可见模型集。
 * 由调用方(WebChat session 鉴权 / 网关 sk 鉴权)构造。
 */
export interface CallContext {
  userId: string;
  /** 主 key:可用全部可见模型;子 key:仅绑定的子集;WebChat:null(走用户可见集)。 */
  apiKeyId?: string | null;
  keyKind: "master" | "sub" | null;
  /** 调用来源,用于用量归属。 */
  source: "chat" | "gateway";
}

/** IR 消息(OpenAI Chat Completions 的 messages 元素)。 */
export interface IRMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | IRContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: IRToolCall[];
}

export interface IRContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface IRToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** IR 请求(OpenAI Chat Completions 请求体的核心字段)。 */
export interface IRRequest {
  model: string;
  messages: IRMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: IRToolDef[];
  tool_choice?: IRToolChoice;
  response_format?: IRResponseFormat;
  stop?: string | string[];
  /** 推理级别(off/low/medium/high);stream 层据此 + route.capabilities 翻译为 providerOptions。 */
  reasoning?: ReasoningLevel;
  /** 透传的原始字段(供 adapter 使用协议特定选项)。 */
  [key: string]: unknown;
}

export interface IRToolDef {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
}

export type IRToolChoice = "auto" | "none" | "required" | {
  type: "function";
  function: { name: string };
};

export interface IRResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    description?: string;
    schema: unknown;
    strict?: boolean;
  };
}

/** IR 用量(AI SDK v5 字段名)。 */
export interface IRUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  /** Anthropic prompt cache。 */
  cachedInputTokens?: number;
}

/** 流式产出的事件 —— streamChat yield 的统一增量。 */
export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "text-retract"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-start"; toolCallId: string; toolName: string }
  | { type: "tool-call-delta"; toolCallId: string; delta: string }
  | { type: "tool-call-end"; toolCallId: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "usage"; usage: IRUsage }
  | { type: "finish"; finishReason: string; usage: IRUsage }
  | { type: "error"; error: string; code?: string; details?: Record<string, unknown> };
