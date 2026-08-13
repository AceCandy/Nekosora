/**
 * Prometheus 指标收集 —— 基于 prom-client。
 *
 * 设计:实时埋点(在 stream.ts / usage.ts 调用),/metrics 端点导出。
 * 所有指标带 label,便于按 source/model/status 维度聚合。
 *
 * 数据来自内存 counter,不依赖 PG 聚合。
 * 默认采集 Node.js 默认指标(heap/GC/eventLoop),便于运维诊断。
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

/** 单例 registry(所有指标注册于此)。 */
export const registry = new Registry();

// Node.js 默认指标(heap size / GC / event loop lag / CPU)。
collectDefaultMetrics({ register: registry, prefix: "nekusora_nodejs_" });

// ---------------------------------------------------------------------------
// 业务指标
// ---------------------------------------------------------------------------

/** 请求计数(按来源 / 模型类型 / 状态)。 */
export const requestTotal = new Counter({
  name: "nekusora_requests_total",
  help: "Total model requests (chat + gateway)",
  labelNames: ["source", "model_type", "status"],
  registers: [registry],
});

/** Token 消耗(按类型 prompt/completion + 模型类型)。 */
export const tokensTotal = new Counter({
  name: "nekusora_tokens_total",
  help: "Tokens consumed by type",
  labelNames: ["type", "model_type"],
  registers: [registry],
});

/** 请求延迟分布(毫秒)。 */
export const requestDurationMs = new Histogram({
  name: "nekusora_request_duration_ms",
  help: "Model request latency in milliseconds",
  labelNames: ["source", "model_type", "status"],
  buckets: [100, 300, 500, 1000, 3000, 5000, 10000, 30000, 60000],
  registers: [registry],
});

/** 逻辑网关执行计数，不携带模型或 route 等高基数标签。 */
export const gatewayExecutionsTotal = new Counter({
  name: "nekusora_gateway_executions_total",
  help: "Final gateway executions",
  labelNames: ["operation", "source", "status", "model_type"],
  registers: [registry],
});

/** 上游尝试计数，与逻辑执行计数分离。 */
export const gatewayAttemptsTotal = new Counter({
  name: "nekusora_gateway_attempts_total",
  help: "Gateway upstream attempts",
  labelNames: ["operation", "status", "protocol"],
  registers: [registry],
});

export const gatewayCircuitBreakerEventsTotal = new Counter({
  name: "nekusora_gateway_circuit_breaker_events_total",
  help: "Gateway circuit breaker lifecycle events",
  labelNames: ["event"],
  registers: [registry],
});

export const gatewayExecutionDurationMs = new Histogram({
  name: "nekusora_gateway_execution_duration_ms",
  help: "Gateway execution latency in milliseconds",
  labelNames: ["operation", "source", "status", "model_type"],
  buckets: [100, 300, 500, 1000, 3000, 5000, 10000, 30000, 60000],
  registers: [registry],
});

export const gatewayGovernanceRejectionsTotal = new Counter({
  name: "nekusora_gateway_governance_rejections_total",
  help: "Gateway governance rejections",
  labelNames: ["reason", "scope", "operation"],
  registers: [registry],
});

export const gatewayGovernanceSettlementsTotal = new Counter({
  name: "nekusora_gateway_governance_settlements_total",
  help: "Gateway governance quota settlements",
  labelNames: ["quota_kind", "outcome"],
  registers: [registry],
});

export const gatewayGovernanceFailuresTotal = new Counter({
  name: "nekusora_gateway_governance_failures_total",
  help: "Gateway governance failures by fixed lifecycle stage",
  labelNames: ["stage"],
  registers: [registry],
});

/** 当前活跃流式连接数(Gauge,反映实时并发)。 */
export const activeStreams = new Gauge({
  name: "nekusora_active_streams",
  help: "Currently active streaming connections",
  registers: [registry],
});

/** 上传文件计数。 */
export const fileUploadsTotal = new Counter({
  name: "nekusora_file_uploads_total",
  help: "Total file uploads",
  labelNames: ["mime_kind"],
  registers: [registry],
});

export const gatewayRetentionClaimsTotal = new Counter({
  name: "nekusora_gateway_retention_claims_total",
  help: "Gateway retention daily claim outcomes",
  labelNames: ["outcome"],
  registers: [registry],
});

export const gatewayRetentionRunsTotal = new Counter({
  name: "nekusora_gateway_retention_runs_total",
  help: "Gateway retention run outcomes",
  labelNames: ["outcome"],
  registers: [registry],
});

export const gatewayRetentionDeletedTotal = new Counter({
  name: "nekusora_gateway_retention_deleted_total",
  help: "Gateway executions deleted by terminal status",
  labelNames: ["status"],
  registers: [registry],
});

export const gatewayRetentionDurationMs = new Histogram({
  name: "nekusora_gateway_retention_duration_ms",
  help: "Gateway retention batch duration in milliseconds",
  buckets: [10, 50, 100, 300, 1000, 3000, 10000, 30000],
  registers: [registry],
});

const REQUEST_SOURCES = ["chat", "gateway"] as const;
const MODEL_TYPES = ["chat", "image", "embedding", "rerank", "audio"] as const;
const EXECUTION_STATUSES = ["success", "failed", "interrupted"] as const;
const GATEWAY_OPERATIONS = [
  "chat.stream",
  "chat.generate",
  "image.generate",
  "audio.speech",
  "audio.transcription",
] as const;
const ATTEMPT_STATUSES = [...EXECUTION_STATUSES, "rejected"] as const;
const PROVIDER_PROTOCOLS = [
  "openai",
  "anthropic",
  "gemini",
  "openai-compatible",
  "openai-images",
  "openai-audio-stt",
  "openai-audio-tts",
] as const;
const CIRCUIT_BREAKER_EVENTS = [
  "no_healthy_route",
  "probe_acquired",
  "probe_succeeded",
  "probe_failed",
  "probe_released",
] as const;
const GOVERNANCE_REASONS = ["rate", "concurrency", "quota"] as const;
const GOVERNANCE_SCOPES = ["key", "user"] as const;
const GOVERNANCE_OPERATIONS = [
  ...GATEWAY_OPERATIONS,
  "mcp.search",
  "chat.request",
  "models.list",
  "mcp.request",
] as const;
const QUOTA_KINDS = ["chat_tokens", "image_count", "tts_code_points", "stt_seconds"] as const;
const GOVERNANCE_FAILURE_STAGES = [
  "repository",
  "policy_load",
  "policy_invalid",
  "rate",
  "lease",
  "quota_reserve",
  "provider_start",
  "heartbeat",
  "finalize",
  "reaper",
] as const;

function fixedLabel(value: string | null | undefined, allowed: readonly string[]): string {
  return value != null && allowed.includes(value) ? value : "unknown";
}

// ---------------------------------------------------------------------------
// 便捷封装:在 streamChat / logUsage 处调用,避免散落的 label 拼装
// ---------------------------------------------------------------------------

/** 记录一次请求完成(含状态与延迟)。供 logUsage 调用。 */
export function observeRequest(params: {
  source: string;
  modelType?: string | null;
  status: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}): void {
  const modelType = fixedLabel(params.modelType, MODEL_TYPES);
  const labels = {
    source: fixedLabel(params.source, REQUEST_SOURCES),
    model_type: modelType,
    status: fixedLabel(params.status, EXECUTION_STATUSES),
  };
  requestTotal.inc(labels);
  requestDurationMs.observe(labels, params.latencyMs);
  if (params.promptTokens > 0) tokensTotal.inc({ type: "prompt", model_type: modelType }, params.promptTokens);
  if (params.completionTokens > 0) tokensTotal.inc({ type: "completion", model_type: modelType }, params.completionTokens);
}

export function observeGatewayExecution(params: {
  operation: string;
  source: string;
  status: string;
  modelType?: string | null;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}): void {
  const modelType = fixedLabel(params.modelType, MODEL_TYPES);
  gatewayExecutionsTotal.inc({
    operation: fixedLabel(params.operation, GATEWAY_OPERATIONS),
    source: fixedLabel(params.source, REQUEST_SOURCES),
    status: fixedLabel(params.status, EXECUTION_STATUSES),
    model_type: modelType,
  });
  gatewayExecutionDurationMs.observe({
    operation: fixedLabel(params.operation, GATEWAY_OPERATIONS),
    source: fixedLabel(params.source, REQUEST_SOURCES),
    status: fixedLabel(params.status, EXECUTION_STATUSES),
    model_type: modelType,
  }, params.latencyMs);
  if (params.promptTokens > 0) {
    tokensTotal.inc({ type: "prompt", model_type: modelType }, params.promptTokens);
  }
  if (params.completionTokens > 0) {
    tokensTotal.inc({ type: "completion", model_type: modelType }, params.completionTokens);
  }
}

export function observeGatewayAttempt(params: {
  operation: string;
  status: string;
  protocol: string;
}): void {
  gatewayAttemptsTotal.inc({
    operation: fixedLabel(params.operation, GATEWAY_OPERATIONS),
    status: fixedLabel(params.status, ATTEMPT_STATUSES),
    protocol: fixedLabel(params.protocol, PROVIDER_PROTOCOLS),
  });
}

export type GatewayCircuitBreakerEvent =
  | "no_healthy_route"
  | "probe_acquired"
  | "probe_succeeded"
  | "probe_failed"
  | "probe_released";

export function observeGatewayCircuitBreakerEvent(event: GatewayCircuitBreakerEvent): void {
  gatewayCircuitBreakerEventsTotal.inc({
    event: fixedLabel(event, CIRCUIT_BREAKER_EVENTS),
  });
}

export function observeGatewayGovernanceRejection(params: {
  reason: string;
  scope: string;
  operation: string;
}): void {
  gatewayGovernanceRejectionsTotal.inc({
    reason: fixedLabel(params.reason, GOVERNANCE_REASONS),
    scope: fixedLabel(params.scope, GOVERNANCE_SCOPES),
    operation: fixedLabel(params.operation, GOVERNANCE_OPERATIONS),
  });
}

export function observeGatewayGovernanceSettlement(params: {
  quotaKind: string;
  outcome: "settled" | "overage";
}): void {
  gatewayGovernanceSettlementsTotal.inc({
    quota_kind: fixedLabel(params.quotaKind, QUOTA_KINDS),
    outcome: fixedLabel(params.outcome, ["settled", "overage"]),
  });
}

export function observeGatewayGovernanceFailure(stage: string): void {
  gatewayGovernanceFailuresTotal.inc({
    stage: fixedLabel(stage, GOVERNANCE_FAILURE_STAGES),
  });
}

export function observeGatewayRetentionClaim(outcome: string): void {
  gatewayRetentionClaimsTotal.inc({
    outcome: fixedLabel(outcome, ["claimed", "skipped", "failed"]),
  });
}

export function observeGatewayRetentionRun(params: {
  outcome: string;
  deleted: Partial<Record<"success" | "failed" | "interrupted", number>>;
  durationMs: number;
}): void {
  gatewayRetentionRunsTotal.inc({
    outcome: fixedLabel(params.outcome, ["success", "failed"]),
  });
  for (const status of EXECUTION_STATUSES) {
    const count = params.deleted[status] ?? 0;
    if (count > 0) gatewayRetentionDeletedTotal.inc({ status }, count);
  }
  gatewayRetentionDurationMs.observe(params.durationMs);
}

/** 进入 streamChat 时 +1(配合 releaseStream 在 finally 调用)。 */
export function acquireStream(): void {
  activeStreams.inc();
}

/** 离开 streamChat 时 -1。 */
export function releaseStream(): void {
  activeStreams.dec();
}

/** 是否启用(METRICS_ENABLED=false 时端点返回 404)。 */
export function metricsEnabled(): boolean {
  return (process.env.METRICS_ENABLED ?? "true").toLowerCase() !== "false";
}

/** 输出 Prometheus 文本格式(供 /metrics 端点)。 */
export async function metricsOutput(): Promise<string> {
  return registry.metrics();
}
