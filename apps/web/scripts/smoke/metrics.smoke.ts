/**
 * metrics.ts 冒烟测试 —— 验证 Prometheus 指标埋点与输出格式。
 * 运行:pnpm tsx scripts/smoke/metrics.smoke.ts
 */
import assert from "node:assert";
import {
  observeGatewayAttempt,
  observeGatewayCircuitBreakerEvent,
  observeGatewayExecution,
  observeRequest,
  acquireStream,
  releaseStream,
  metricsOutput,
  registry,
} from "@/lib/infra/metrics";

async function run() {
  // 注意:不调用 registry.resetMetrics() —— prom-client 的 resetMetrics 会从 registry
  // 移除模块顶层 new 的指标实例,而模块变量仍指向旧实例,导致后续 .inc() 失效。
  // 这里接受计数累加,仅验证功能正确性(增量、输出格式、指标存在性)。

  // 1. observeRequest 应同时记录请求计数、延迟、token 计数
  observeRequest({
    source: "chat", modelType: "chat", status: "success", latencyMs: 1200,
    promptTokens: 100, completionTokens: 50,
  });
  observeRequest({
    source: "gateway", modelType: "chat", status: "success", latencyMs: 800,
    promptTokens: 200, completionTokens: 80,
  });
  observeRequest({
    source: "chat", modelType: "chat", status: "failed", latencyMs: 300,
    promptTokens: 0, completionTokens: 0,
  });
  console.log("✓ observeRequest 多次调用通过");
  observeGatewayExecution({
    operation: "chat.stream", source: "chat", status: "success", latencyMs: 100,
    promptTokens: 1, completionTokens: 1,
  });
  observeGatewayAttempt({ operation: "chat.stream", status: "success", protocol: "openai" });
  observeGatewayCircuitBreakerEvent("no_healthy_route");

  // 2. activeStreams gauge 增减(prom-client v15 的 get() 异步,改用 metrics 文本解析)
  acquireStream();
  acquireStream();
  let text = await metricsOutput();
  let line = text.match(/^nekusora_active_streams\s+([0-9.]+)/m);
  assert.strictEqual(line ? Number(line[1]) : NaN, 2, "acquire 两次应为 2");
  releaseStream();
  text = await metricsOutput();
  line = text.match(/^nekusora_active_streams\s+([0-9.]+)/m);
  assert.strictEqual(line ? Number(line[1]) : NaN, 1, "release 后应为 1");
  releaseStream();
  console.log("✓ activeStreams acquire/release 通过");

  // 3. metricsOutput 输出 Prometheus 文本格式(应含指标名与 HELP/TYPE 行)
  const out = await metricsOutput();
  assert.ok(out.includes("nekusora_requests_total"), "输出应含 requests_total");
  assert.ok(out.includes("# HELP"), "输出应含 HELP 行");
  assert.ok(out.includes("# TYPE"), "输出应含 TYPE 行");
  assert.ok(out.includes('model_type="chat"'), "输出应含固定 model_type label");
  console.log("✓ metricsOutput Prometheus 文本格式通过");

  // 4. 验证关键指标名存在(getMetricsAsArray 返回逻辑名,Histogram 不带 _bucket 后缀)
  const names = registry.getMetricsAsArray().map((m) => m.name);
  assert.ok(names.includes("nekusora_requests_total"), "应注册 requests_total");
  assert.ok(names.includes("nekusora_tokens_total"), "应注册 tokens_total");
  assert.ok(names.includes("nekusora_request_duration_ms"), "应注册延迟直方图");
  assert.ok(names.includes("nekusora_active_streams"), "应注册活跃流式 gauge");
  assert.ok(names.includes("nekusora_file_uploads_total"), "应注册文件上传计数");
  assert.ok(names.includes("nekusora_gateway_executions_total"), "应注册 execution 计数");
  assert.ok(names.includes("nekusora_gateway_attempts_total"), "应注册 attempt 计数");
  assert.ok(
    names.includes("nekusora_gateway_circuit_breaker_events_total"),
    "应注册 circuit breaker 事件计数",
  );
  assert.ok(names.includes("nekusora_gateway_execution_duration_ms"), "应注册 execution 延迟");
  console.log("✓ 所有关键指标注册通过");

  console.log("\n全部通过 ✅");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
