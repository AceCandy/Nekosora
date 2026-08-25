import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type {
  GatewayGovernanceHourlyPoint,
  GatewayGovernanceQuotaReplay,
  GatewayGovernanceReplay,
  GovernanceHistoryRange,
} from "@/lib/gateway-governance/analytics";

interface GovernanceHistoryPanelProps {
  range: GovernanceHistoryRange;
  points: GatewayGovernanceHourlyPoint[];
  replay: GatewayGovernanceReplay[];
  quotas: GatewayGovernanceQuotaReplay[];
  lastUpdatedAt: Date | null;
  dataDelayed: boolean;
}

export default async function GovernanceHistoryPanel({
  range,
  points,
  replay,
  quotas,
  lastUpdatedAt,
  dataDelayed,
}: GovernanceHistoryPanelProps) {
  const [t, locale] = await Promise.all([
    getTranslations("admin.settings.governance"),
    getLocale(),
  ]);
  const recent = points.slice(-24);
  const maxRequests = Math.max(1, ...recent.map((point) => point.requestCount));

  return (
    <section className="space-y-4" aria-labelledby="governance-history-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="governance-history-title" className="text-ui-subheading font-semibold text-space-ink">
            {t("historyTitle")}
          </h3>
          <p className="mt-1 text-ui-body text-neutral-600">{t("historyDesc")}</p>
        </div>
        <div className="inline-flex rounded-md border border-morning-mist bg-nebula-white p-1" aria-label={t("rangeLabel")}>
          {([7, 30, 90] as const).map((days) => (
            <Link
              key={days}
              href={`/admin/settings?tab=governance&view=history&range=${days}`}
              aria-current={range === days ? "page" : undefined}
              className={range === days
                ? "touch-target rounded bg-neutral-100 px-3 py-2 text-ui-caption font-medium text-space-ink"
                : "touch-target rounded px-3 py-2 text-ui-caption text-neutral-500 hover:text-space-ink"}
            >
              {t("rangeDays", { days })}
            </Link>
          ))}
        </div>
      </div>

      <p className={dataDelayed ? "text-ui-caption text-warning" : "text-ui-caption text-neutral-500"} role={dataDelayed ? "status" : undefined}>
        {lastUpdatedAt
          ? t(dataDelayed ? "dataDelayed" : "lastUpdated", {
            time: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(lastUpdatedAt),
          })
          : t("historyEmpty")}
      </p>

      {points.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-morning-mist bg-nebula-white">
            <table className="w-full min-w-[640px] border-collapse text-left text-ui-body">
              <thead className="border-b border-morning-mist bg-neutral-50/70 text-ui-caption text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("scope")}</th>
                  <th className="px-3 py-2 font-medium">{t("requestCount")}</th>
                  <th className="px-3 py-2 font-medium">{t("rpmPeak")}</th>
                  <th className="px-3 py-2 font-medium">{t("concurrencyPeak")}</th>
                  <th className="px-3 py-2 font-medium">{t("rejections")}</th>
                  <th className="px-3 py-2 font-medium">{t("historicalReplay")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-morning-mist">
                {(["key", "user"] as const).map((scope) => {
                  const scoped = points.filter((point) => point.scope === scope);
                  const replayRow = replay.find((item) => item.scope === scope)!;
                  const requests = scoped.reduce((sum, point) => sum + point.requestCount, 0);
                  const rejections = scoped.reduce((sum, point) => sum + rejectionCount(point), 0);
                  return (
                    <tr key={scope}>
                      <th className="px-3 py-3 font-medium text-space-ink">{t(scope === "key" ? "keyScope" : "userScope")}</th>
                      <td className="px-3 py-3 font-mono">{requests.toLocaleString(locale)}</td>
                      <td className="px-3 py-3 font-mono">{Math.max(0, ...scoped.map((point) => point.rpmPeak))}</td>
                      <td className="px-3 py-3 font-mono">{Math.max(0, ...scoped.map((point) => point.concurrencyPeak))}</td>
                      <td className="px-3 py-3 font-mono">{rejections.toLocaleString(locale)}</td>
                      <td className="px-3 py-3 text-ui-caption text-neutral-600">
                        {t("replaySummary", {
                          rpm: replayRow.rpmExceededHours,
                          concurrency: replayRow.concurrencyExceededHours,
                          hours: replayRow.hours,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5 rounded-lg border border-morning-mist bg-nebula-white p-3" aria-label={t("timelineLabel")}>
            {recent.map((point) => (
              <div key={`${point.bucketStart.toISOString()}:${point.scope}`} className="grid grid-cols-[7rem_3rem_minmax(0,1fr)] items-center gap-2 text-ui-caption">
                <time className="font-mono text-neutral-500">
                  {new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit" }).format(point.bucketStart)}
                </time>
                <span className="text-neutral-500">{t(point.scope === "key" ? "keyScopeShort" : "userScopeShort")}</span>
                <div className="h-2 rounded-full bg-neutral-100" title={t("requestsValue", { count: point.requestCount })}>
                  <div className="h-full rounded-full bg-sora-blue/45" style={{ width: `${Math.max(2, point.requestCount / maxRequests * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          {quotas.length > 0 && (
            <p className="text-ui-caption text-neutral-600">
              {t("quotaReplaySummary", {
                count: quotas.reduce((sum, quota) => sum + quota.subjectsOverCandidate, 0),
              })}
            </p>
          )}
          <p className="text-ui-caption text-neutral-500">{t("replayDisclaimer")}</p>
        </>
      )}
    </section>
  );
}

function rejectionCount(point: GatewayGovernanceHourlyPoint): number {
  return point.rateRejected
    + point.concurrencyRejected
    + point.quotaChatTokensRejected
    + point.quotaImageCountRejected
    + point.quotaTtsCodePointsRejected
    + point.quotaSttSecondsRejected;
}
