/**
 * 用量记录 —— 把每次生成(成功/失败)写入 usage_logs。
 * 供 WebChat 和网关统一调用,带来源、身份、token 拆分归属。
 */
import { getDb, getSchema } from "@/lib/infra/db";
import type { CallContext, IRUsage } from "@/lib/providers/types";

export interface LogUsageParams {
  ctx: CallContext;
  runId: string;
  model: string;
  providerRef?: string;
  usage: IRUsage;
  latencyMs: number;
  status: "success" | "failed" | "interrupted";
  errorCode?: string;
}

/** 记录一条用量。失败不抛错(用量记录不应阻断主流程)。 */
export async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    const db = await getDb();
    const schema = getSchema();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = schema as any;

    await db.insert(s.usageLogs).values({
      source: params.ctx.source,
      userId: params.ctx.userId,
      apiKeyId: params.ctx.apiKeyId ?? null,
      keyKind: params.ctx.keyKind,
      model: params.model,
      providerRef: params.providerRef ?? null,
      promptTokens: params.usage.inputTokens ?? 0,
      completionTokens: params.usage.outputTokens ?? 0,
      cacheReadTokens: params.usage.cachedInputTokens ?? 0,
      cacheWriteTokens: 0, // AI SDK v5 暂不细分 write,留 0
      reasoningTokens: params.usage.reasoningTokens ?? 0,
      latencyMs: params.latencyMs,
      status: params.status,
    });

    // 同步埋点 Prometheus 指标(metrics 失败不影响主流程)。
    try {
      const { observeRequest } = await import("@/lib/infra/metrics");
      observeRequest({
        source: params.ctx.source,
        model: params.model,
        status: params.status,
        latencyMs: params.latencyMs,
        promptTokens: params.usage.inputTokens ?? 0,
        completionTokens: params.usage.outputTokens ?? 0,
      });
    } catch {
      /* metrics 埋点失败忽略 */
    }
  } catch (err) {
    // 用量记录失败不应影响主流程。
    console.error("[logUsage] 记录失败:", err);
  }
}
