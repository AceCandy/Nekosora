/**
 * 用量记录 —— 把每次生成(成功/失败)写入日志表。
 *
 * 网关日志重构后物理双表分流:
 *   - status=success            → usage_logs(成功计费,含 TTFT / 可读服务商名 / 路由名 / 真实上游模型)
 *   - status=failed/interrupted → ops_error_logs(失败 / 中断,含 errorCode / httpStatus / errorPhase ...)
 *
 * 供 WebChat 和网关统一调用,带来源、身份、token 拆分归属。
 * 失败不抛错(日志记录不应阻断主流程)。
 */
import { getDb, getSchema } from "@/lib/infra/db";
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
  /** 错误信息(脱敏后)。Phase 3 由 gateway route.ts / stream.ts 补传。 */
  errorMessage?: string;
  /** HTTP 状态码(区别于枚举 status)。Phase 3 补传。 */
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
  /** 请求路径(如 /v1/chat/completions)。Phase 3 补传。 */
  requestPath?: string;
  /** 是否流式。Phase 3 补传(stream.ts 已知 stream=true,但走默认 false 也不阻断)。 */
  stream?: boolean;
  /** 错误生命周期阶段(routing/upstream/network/internal/auth/request)。Phase 3 由 error-classify 填充。 */
  errorPhase?: string;
  /** 错误具体类型。Phase 3 补传。 */
  errorType?: string;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *;运行时从明文算,绝不存明文)。 */
  upstreamKeyMasked?: string | null;
  /** 副任务类型(null=主回复/网关请求;title/memory/compact=后台副任务)。 */
  taskKind?: string;
  /**
   * 尝试序号(1..N)。方案 X:每次 key 尝试失败各记一条 ops_error_logs,带递增 attempt。
   * 缺省 null=非尝试记录(中断/最终结果)。成功走 usage_logs,不涉及此字段。
   */
  attempt?: number;
  /**
   * 跳过 Prometheus 埋点(observeRequest)。中间失败重试记录传 true:
   * 一次请求只应在最终结果(success/interrupted/failed)埋一次点,
   * 中间每次尝试失败若也埋点会导致 nekusora_requests_total 重复计数。
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

/** 记录一条用量/错误日志。失败不抛错(日志记录不应阻断主流程)。 */
export async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    const db = await getDb();
    const schema = getSchema();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = schema as any;

    if (params.status === "success") {
      // 成功计费 → usage_logs(写新增的 5 个字段)。
      // userId 强制非空兜底:FK 列收空字符串会触发外键违反,统一收敛 null。
      await db.insert(s.usageLogs).values({
        source: params.ctx.source,
        userId: params.ctx.userId || null,
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
        firstTokenLatencyMs: params.firstTokenLatencyMs ?? null,
        providerName: params.providerName ?? null,
        routeId: params.routeId ?? null,
        routeName: params.routeName ?? null,
        upstreamModel: params.upstreamModel ?? null,
        upstreamKeyMasked: params.upstreamKeyMasked ?? null,
        taskKind: params.taskKind ?? null,
      });
    } else {
      // 失败 / 中断 → ops_error_logs(本 Phase 能拿到的先写,缺失的留 null)。
      // userId 强制非空兜底:鉴权失败等场景无 userId,空字符串会触发 FK 违反,统一收敛 null。
      await db.insert(s.opsErrorLogs).values({
        requestId: params.runId,
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
        httpStatus: params.httpStatus ?? null,
        errorCode: params.errorCode ?? "unknown",
        errorMessage: params.errorMessage ?? null,
        errorPhase: params.errorPhase ?? null,
        errorType: params.errorType ?? null,
        promptTokens: params.usage.inputTokens ?? 0,
        completionTokens: params.usage.outputTokens ?? 0,
        latencyMs: params.latencyMs,
        firstTokenLatencyMs: params.firstTokenLatencyMs ?? null,
        taskKind: params.taskKind ?? null,
        attempt: params.attempt ?? null,
      });
    }

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
    console.error("[logUsage] 记录失败:", err);
  }
}
