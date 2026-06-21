/**
 * Prometheus metrics 端点 —— GET /metrics
 *
 * 输出 prom-client 收集的文本格式指标。Prometheus 抓取:
 *   - nekusora_requests_total{source,model,status}
 *   - nekusora_tokens_total{type,model}
 *   - nekusora_request_duration_ms_bucket{...}
 *   - nekusora_active_streams
 *   - nekusora_nodejs_* (heap/GC/eventLoop 默认指标)
 *
 * 鉴权:生产环境建议在反向代理(nginx/网关)层限制来源 IP,或加 token 校验。
 * 默认公开,因为 Prometheus 抓取通常走集群内网。
 *
 * METRICS_ENABLED=false 时返回 404。
 */
import { NextResponse } from "next/server";
import { metricsEnabled, metricsOutput } from "@/lib/infra/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Prometheus 文本格式(非 JSON)。
export const contentType = "text/plain; version=0.0.4; charset=utf-8";

export async function GET() {
  if (!metricsEnabled()) {
    return new NextResponse("metrics disabled", { status: 404 });
  }
  const body = await metricsOutput();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
