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

/** 请求计数(按来源 / 模型 / 状态)。 */
export const requestTotal = new Counter({
  name: "nekusora_requests_total",
  help: "Total model requests (chat + gateway)",
  labelNames: ["source", "model", "status"],
  registers: [registry],
});

/** Token 消耗(按类型 prompt/completion + 模型)。 */
export const tokensTotal = new Counter({
  name: "nekusora_tokens_total",
  help: "Tokens consumed by type",
  labelNames: ["type", "model"],
  registers: [registry],
});

/** 请求延迟分布(毫秒)。 */
export const requestDurationMs = new Histogram({
  name: "nekusora_request_duration_ms",
  help: "Model request latency in milliseconds",
  labelNames: ["source", "model", "status"],
  buckets: [100, 300, 500, 1000, 3000, 5000, 10000, 30000, 60000],
  registers: [registry],
});

/** 逻辑网关执行计数，不携带模型或 route 等高基数标签。 */
export const gatewayExecutionsTotal = new Counter({
  name: "nekusora_gateway_executions_total",
  help: "Final gateway executions",
  labelNames: ["operation", "source", "status"],
  registers: [registry],
});

/** 上游尝试计数，与逻辑执行计数分离。 */
export const gatewayAttemptsTotal = new Counter({
  name: "nekusora_gateway_attempts_total",
  help: "Gateway upstream attempts",
  labelNames: ["operation", "status", "protocol"],
  registers: [registry],
});

export const gatewayExecutionDurationMs = new Histogram({
  name: "nekusora_gateway_execution_duration_ms",
  help: "Gateway execution latency in milliseconds",
  labelNames: ["operation", "source", "status"],
  buckets: [100, 300, 500, 1000, 3000, 5000, 10000, 30000, 60000],
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

// ---------------------------------------------------------------------------
// 便捷封装:在 streamChat / logUsage 处调用,避免散落的 label 拼装
// ---------------------------------------------------------------------------

/** 记录一次请求完成(含状态与延迟)。供 logUsage 调用。 */
export function observeRequest(params: {
  source: string;
  model: string;
  status: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}): void {
  const labels = { source: params.source, model: params.model, status: params.status };
  requestTotal.inc(labels);
  requestDurationMs.observe(labels, params.latencyMs);
  if (params.promptTokens > 0) tokensTotal.inc({ type: "prompt", model: params.model }, params.promptTokens);
  if (params.completionTokens > 0) tokensTotal.inc({ type: "completion", model: params.model }, params.completionTokens);
}

export function observeGatewayExecution(params: {
  operation: string;
  source: string;
  status: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}): void {
  gatewayExecutionsTotal.inc({
    operation: params.operation,
    source: params.source,
    status: params.status,
  });
  gatewayExecutionDurationMs.observe({
    operation: params.operation,
    source: params.source,
    status: params.status,
  }, params.latencyMs);
}

export function observeGatewayAttempt(params: {
  operation: string;
  status: string;
  protocol: string;
}): void {
  gatewayAttemptsTotal.inc(params);
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
