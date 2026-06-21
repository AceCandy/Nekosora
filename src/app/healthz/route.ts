/**
 * 健康检查端点。
 *
 * GET /healthz        —— 存活探针(liveness):进程在跑就 200。
 * GET /healthz/ready  —— 就绪探针(readiness):检查 DB / Storage / Queue 等依赖。
 *
 * 部署时:
 *   - livenessProbe  → /healthz(重启判定)
 *   - readinessProbe → /healthz/ready(流量判定)
 *
 * 鉴权:公开(探针不带 cookie/session)。不暴露任何敏感信息。
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** liveness:进程存活即 OK。 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    ts: Date.now(),
  });
}
