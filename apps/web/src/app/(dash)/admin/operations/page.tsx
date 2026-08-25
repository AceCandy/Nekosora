/**
 * 运维监控页 —— /admin/operations
 *
 * 展示系统实时信息:DB、存储 driver、Redis、队列、Prometheus 指标快照。
 * 数据来源:getEnvInfo() + 内存 metrics(避免复杂查询,纯展示)。
 *
 * 对标 admin 其他页:莫兰迪灰调、shadow-none、border 细线分隔。
 */
import { desc, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireAdmin } from "@/lib/session";
import { getEnvInfo } from "@/lib/infra/env";
import { metricsOutput } from "@/lib/infra/metrics";
import { Activity } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export const dynamic = "force-dynamic";

/** 从 Prometheus 文本输出解析单个无 label gauge 的当前值。 */
async function readGauge(name: string): Promise<number> {
  const text = await metricsOutput();
  // 匹配形如 "nekusora_active_streams 3"(指标行,非 HELP/TYPE)。
  const m = text.match(new RegExp(`^${name}\\s+([0-9.]+)`, "m"));
  return m ? Number(m[1]) : 0;
}

export default async function OperationsPage() {
  const t = await getTranslations("admin.operations");
  const tn = await getTranslations("nav");
  await requireAdmin();
  const env = getEnvInfo();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 各服务商 + 上游模型近 90 天成功率；providerRef 仅作为稳定分组键，不对用户展示。
  const upstreamModel = sql<string>`coalesce(${s.gatewayExecutions.upstreamModel}, ${s.gatewayExecutions.model})`;
  const providerHealth = await db
    .select({
      providerRef: s.gatewayExecutions.providerRef,
      providerName: s.gatewayExecutions.providerName,
      upstreamModel,
      total: sql<number>`count(*)`,
      success: sql<number>`sum(case when ${s.gatewayExecutions.status} = 'success' then 1 else 0 end)`,
      avgLatency: sql<number>`coalesce(avg(${s.gatewayExecutions.latencyMs}),0)`,
    })
    .from(s.gatewayExecutions)
    .where(sql`
      ${s.gatewayExecutions.providerRef} is not null
      and ${s.gatewayExecutions.createdAt} >= statement_timestamp() - interval '90 days'
    `)
    .groupBy(s.gatewayExecutions.providerRef, s.gatewayExecutions.providerName, upstreamModel)
    .orderBy(desc(sql`count(*)`));

  // 从 registry 文本输出读活跃流式计数(prom-client v15 get() 为异步,改走 metrics 文本)。
  const activeStreamsValue = await readGauge("nekusora_active_streams");

  // createdAt 为 PG timestamp,统一用 now() - 1 hour。
  const lastHourCalls = await db
    .select({ calls: sql<number>`count(*)` })
    .from(s.gatewayExecutions)
    .where(sql`${s.gatewayExecutions.createdAt} > now() - interval '1 hour'`);

  return (
    <div className="space-y-10">
      <PageHeader icon={Activity} title={tn("operations")} desc={t("desc")} />

      {/* 实时指标卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard label={t("metricActiveStreams")} value={String(activeStreamsValue)} hint={t("metricActiveStreamsHint")} />
        <InfoCard label={t("metricLastHourCalls")} value={String(Number(lastHourCalls[0]?.calls ?? 0))} hint={t("metricLastHourCallsHint")} />
        <InfoCard label={t("metricDb")} value="PostgreSQL" hint="PostgreSQL + pgvector" />
        <InfoCard label={t("metricStorage")} value={env.storageDriver} hint={env.storageDriver === "local" ? t("storageLocal") : t("storageS3")} />
      </div>

      {/* 系统依赖状态 */}
      <div className="space-y-4">
        <h2 className="text-ui-title font-semibold text-neutral-900 ">{t("depsTitle")}</h2>
        <div className="rounded-lg border border-neutral-200 bg-white   overflow-hidden shadow-none">
          <div className="divide-y divide-neutral-100 ">
            <DepRow name={t("metricDb")} value="PostgreSQL + pgvector" ok />
            <DepRow name={t("depCache")} value={env.hasRedis ? "Redis" : t("depCacheLru")} ok />
            <DepRow
              name={t("depQueue")}
              value={t("depQueueWorker")}
              ok
            />
            <DepRow
              name={t("depStorage")}
              value={env.storageDriver === "local" ? t("depStorageLocal") : `${env.storageDriver} (S3)`}
              ok
            />
            <DepRow name={t("depMetrics")} value="/metrics (Prometheus)" ok />
            <DepRow name={t("depHealth")} value="/healthz · /healthz/ready" ok />
          </div>
        </div>
      </div>

      {/* Provider 健康(近 90 天) */}
      <div className="space-y-4">
        <h2 className="text-ui-title font-semibold text-neutral-900 ">{t("providerHealthTitle")}</h2>
        <div className="rounded-lg border border-neutral-200 bg-white   overflow-hidden shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-ui-body border-collapse">
              <thead>
                <tr className="bg-neutral-50/70 border-b border-neutral-200 text-neutral-500    text-ui-caption uppercase tracking-wider font-semibold">
                  <th className="text-left px-5 py-3">{t("thProvider")}</th>
                  <th className="text-left px-5 py-3">{t("thModel")}</th>
                  <th className="text-right px-5 py-3">{t("thCalls")}</th>
                  <th className="text-right px-5 py-3">{t("thSuccessRate")}</th>
                  <th className="text-right px-5 py-3">{t("thAvgLatency")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 ">
                {providerHealth.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-neutral-400 ">
                      {t("providerEmpty")}
                    </td>
                  </tr>
                )}
                {providerHealth.map((r: Record<string, unknown>) => {
                  const total = Number(r.total);
                  const success = Number(r.success);
                  const rate = total > 0 ? (success / total) * 100 : 0;
                  const avgLat = Math.round(Number(r.avgLatency));
                  const healthy = rate >= 95;
                  return (
                    <tr key={`${String(r.providerRef)}:${String(r.providerName)}:${String(r.upstreamModel)}`} className="hover:bg-neutral-50/30  transition-colors duration-150">
                      <td className="px-5 py-3.5 font-medium text-neutral-900 ">
                        {String(r.providerName ?? "").trim() || t("unknownProvider")}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-ui-caption text-neutral-700 ">
                        {String(r.upstreamModel)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-ui-caption text-neutral-700 ">
                        {total.toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-ui-caption">
                        <span className={healthy ? "text-success " : "text-warning "}>
                          {rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-ui-caption text-neutral-500 ">
                        {avgLat}ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white   p-4 shadow-none">
      <div className="text-ui-caption text-neutral-400  font-semibold">{label}</div>
      <div className="mt-1.5 text-ui-title font-bold font-mono text-neutral-900 ">{value}</div>
      {hint && <div className="mt-0.5 text-ui-caption text-neutral-400 ">{hint}</div>}
    </div>
  );
}

function DepRow({ name, value, ok }: { name: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-500" : "bg-amber-500"}`} />
        <span className="text-ui-body font-medium text-neutral-700 ">{name}</span>
      </div>
      <span className="text-ui-caption font-mono text-neutral-500 ">{value}</span>
    </div>
  );
}
