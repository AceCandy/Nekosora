/**
 * Provider 相关共享类型(仅类型,无运行时值)。
 * 本文件为普通类型模块,不是 server action 文件;类型在编译期擦除,不会进入客户端 bundle。
 */

// 通用 Server Action 类型已挪到 shared(避免 shared/ui 反向依赖 features)。
// 此处 re-export 保持向后兼容,新代码请直接 import from "@/shared/lib/types"。
export type { FormDataSerializableAction } from "@/shared/lib/types";

/** 服务商上游模型点击后，用于完全匹配和相似候选的轻量模型数据。 */
export interface ProviderModelCandidate {
  id: string;
  name: string;
  displayName?: string;
  catalogId: string;
  catalogName: string;
  canonicalModelId: string;
  aliases: string[];
}

/** 已配置路由的三字段引用，用于前端即时标记但不替代服务端判重。 */
export interface ProviderRouteRef {
  modelId: string;
  providerId: string;
  upstreamModelName: string;
}

export type AttachProviderModelRouteAction = (
  modelId: string,
  providerId: string,
  upstreamModelName: string,
) => Promise<{ status: "created" | "exists" }>;
