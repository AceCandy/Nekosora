import { sql, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import { getTimeSeries, getModelBreakdown, getSourceBreakdown, type TimeRange } from "@/lib/usage-aggregate";
import { UsageDashboard } from "@/app/(dash)/admin/usage/UsageDashboard";

// 个人用量面板:仅聚合当前用户自己的调用记录。
const VALID_RANGES = new Set<TimeRange>(["24h", "7d", "30d"]);

export default async function PanelUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireSession();
  const t = await getTranslations("admin.usage");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const { range: rangeParam } = await searchParams;
  const range: TimeRange = VALID_RANGES.has(rangeParam as TimeRange)
    ? (rangeParam as TimeRange)
    : "7d";

  // 图表数据(限定当前用户)
  const [series, byModel, bySource] = await Promise.all([
    getTimeSeries(range, user.id),
    getModelBreakdown(range, user.id),
    getSourceBreakdown(range, user.id),
  ]);

  // 个人总量(全表,不受时间范围影响)
  const totals = await db
    .select({
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${s.usageLogs.promptTokens}),0)`,
      completionTokens: sql<number>`coalesce(sum(${s.usageLogs.completionTokens}),0)`,
    })
    .from(s.usageLogs)
    .where(eq(s.usageLogs.userId, user.id));

  return (
    <div className="space-y-10 max-w-5xl">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{t("myUsage")}</h1>

      <UsageDashboard
        range={range}
        totals={{
          calls: Number(totals[0]?.calls ?? 0),
          promptTokens: Number(totals[0]?.promptTokens ?? 0),
          completionTokens: Number(totals[0]?.completionTokens ?? 0),
        }}
        series={series}
        byModel={byModel}
        bySource={bySource}
      />
    </div>
  );
}
