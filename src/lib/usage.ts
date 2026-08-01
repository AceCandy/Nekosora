/**
 * 兼容日志入口 —— 在调用方迁入 execution engine 前写最终 execution 事实。
 *
 * 供 WebChat 和网关统一调用,带来源、身份、token 拆分归属。
 * 失败不抛错(日志记录不应阻断主流程)。
 */
import { withBestEffortTimeout } from "@/lib/best-effort";
import { getDb, getSchema } from "@/lib/infra/db";
import { redactErrorMessage, redactSensitiveText } from "@/lib/redaction";
import type { CallContext, IRUsage } from "@/lib/providers/types";

export interface LogUsageParams {
  ctx: CallContext;
  runId: string;
  model: string;
  providerRef?: string;
  usage: IRUsage;
  /** 端到端耗时;中间失败重试记录未计量单次耗时不传(留 null)。 */
  latencyMs?: number;
  status: "success" | "failed" | "interrupted";
  errorCode?: string;
  // —— 网关日志重构新增(均为可选,缺失留 null) ——
  /** 错误信息(脱敏后)。 */
  errorMessage?: string;
  /** HTTP 状态码(区别于枚举 status)。 */
  httpStatus?: number;
  /** 命中路由 id 溯源。 */
  routeId?: string;
  /** 组合路由展示名(providerName · upstreamModel)。 */
  routeName?: string;
  /** 可读服务商名快照(替代裸 providerRef 展示)。 */
  providerName?: string;
  /** 真实上游模型名(区别于对外 model)。 */
  upstreamModel?: string;
  /** 首 token 延迟(TTFT);非流式 / 未产出首 token 时为 undefined。 */
  firstTokenLatencyMs?: number;
  /** 请求路径(如 /v1/chat/completions)。 */
  requestPath?: string;
  /** 是否流式。 */
  stream?: boolean;
  /** 错误生命周期阶段(routing/upstream/network/internal/auth/request)。 */
  errorPhase?: string;
  /** 错误具体类型。 */
  errorType?: string;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *;运行时从明文算,绝不存明文)。 */
  upstreamKeyMasked?: string | null;
  /** 副任务类型(null=主回复/网关请求;title/memory/compact=后台副任务)。 */
  taskKind?: string;
  /** 旧调用方兼容字段；上游尝试审计由 gateway_attempts 统一负责。 */
  attempt?: number;
  /**
   * 跳过 Prometheus 埋点(observeRequest)。中间失败重试记录传 true:
   * 一次请求只应在最终结果(success/interrupted/failed)埋一次点,
   * 中间每次尝试失败若也埋点会导致请求指标重复计数。
   */
  skipMetrics?: boolean;
}

/**
 * 上游 provider key 脱敏:前3后3,中间 `*`。短 key 兜底不暴露全量。
 * 运行时持明文,只把脱敏结果写入日志(绝不存明文)。
 * - null/undefined -> null;空字符串(无 key provider)-> 「无key」
 * - length <= 6 → `${k.slice(0,2)}***`(避免短 key 泄露全量)
 * - 否则 → `${k.slice(0,3)}***${k.slice(-3)}`
 */
export function maskKey(k?: string | null): string | null {
  // 空字符串 = 无 key provider(如 OVH 免费层):日志以「无key」标识,区别于 null(字段缺失)。
  if (k === "") return "无key";
  if (!k) return null;
  return k.length <= 6 ? `${k.slice(0, 2)}***` : `${k.slice(0, 3)}***${k.slice(-3)}`;
}

async function logUsageInternal(params: LogUsageParams): Promise<void> {
  try {
    const db = await getDb();
    const schema = getSchema();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = schema as any;

    await db.insert(s.gatewayExecutions).values({
      requestId: params.runId,
      operation: inferLegacyOperation(params),
      source: params.ctx.source,
      userId: params.ctx.userId || null,
      apiKeyId: params.ctx.apiKeyId ?? null,
      keyKind: params.ctx.keyKind,
      model: params.model,
      upstreamModel: params.upstreamModel ?? null,
      providerName: params.providerName ?? null,
      providerRef: params.providerRef ?? null,
      routeId: params.routeId ?? null,
      routeName: params.routeName ?? null,
      upstreamKeyMasked: params.upstreamKeyMasked ?? null,
      requestPath: params.requestPath ?? null,
      stream: params.stream ?? false,
      status: params.status,
      httpStatus: params.httpStatus ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ? redactSensitiveText(params.errorMessage) : null,
      errorPhase: params.errorPhase ?? null,
      errorType: params.errorType ?? null,
      promptTokens: params.usage.inputTokens ?? 0,
      completionTokens: params.usage.outputTokens ?? 0,
      cacheReadTokens: params.usage.cachedInputTokens ?? 0,
      cacheWriteTokens: 0,
      reasoningTokens: params.usage.reasoningTokens ?? 0,
      latencyMs: params.latencyMs,
      firstTokenLatencyMs: params.firstTokenLatencyMs ?? null,
      taskKind: params.taskKind ?? null,
      completedAt: new Date(),
    });

    // 同步埋点 Prometheus 指标(metrics 失败不影响主流程)。
    // skipMetrics=true 时跳过(中间失败重试记录:一次请求只在最终结果埋一次点)。
    if (!params.skipMetrics) {
      try {
        const { observeRequest } = await import("@/lib/infra/metrics");
        observeRequest({
          source: params.ctx.source,
          model: params.model,
          status: params.status,
          latencyMs: params.latencyMs ?? 0,
          promptTokens: params.usage.inputTokens ?? 0,
          completionTokens: params.usage.outputTokens ?? 0,
        });
      } catch {
        /* metrics 埋点失败忽略 */
      }
    }
  } catch (err) {
    // 日志记录失败不应影响主流程。
    console.error("[logUsage] 记录失败:", redactErrorMessage(err));
  }
}

function inferLegacyOperation(params: LogUsageParams): string {
  if (params.requestPath === "/v1/images/generations") return "image.generate";
  if (params.requestPath === "/v1/audio/speech") return "audio.speech";
  if (params.requestPath === "/v1/audio/transcriptions") return "audio.transcription";
  return params.stream ? "chat.stream" : "chat.generate";
}

/** 记录一条用量/错误日志。失败或超时不阻断主流程。 */
export async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    await withBestEffortTimeout(() => logUsageInternal(params));
  } catch (err) {
    console.error("[logUsage] 记录失败:", redactErrorMessage(err));
  }
}
