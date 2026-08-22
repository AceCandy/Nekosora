import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, BarChart3, Boxes, Server, Users } from "lucide-react";
import { listProviders, listModels, listRoutes, listUsers } from "./actions";

const QUICK_LINK_ICONS = [Server, Boxes, Users, BarChart3] as const;

export default async function AdminHomePage() {
  const t = await getTranslations("admin.overview");
  const [providers, models, routes, users] = await Promise.all([
    listProviders(),
    listModels(),
    listRoutes(),
    listUsers(),
  ]);

  const enabledProviders = providers.filter((p: Record<string, unknown>) => p.enabled).length;
  const enabledModels = models.filter((m: Record<string, unknown>) => m.enabled).length;
  const activeUsers = users.filter((u: Record<string, unknown>) => u.status === "active").length;

  // label/sub 存 i18n key,渲染时翻译(value 是动态数字)。
  // showRatio 为 true 的格在底部渲染「启用占比」仪表条(routesSub 是纯说明文案,无占比意义)。
  const stats = [
    { labelKey: "statProviders", value: providers.length, subKey: "enabled", subCount: enabledProviders, showRatio: true, href: "/admin/providers" },
    { labelKey: "statModels", value: models.length, subKey: "enabled", subCount: enabledModels, showRatio: true, href: "/admin/models" },
    { labelKey: "statRoutes", value: routes.length, subKey: "routesSub", subCount: 0, showRatio: false, href: "/admin/models" },
    { labelKey: "statUsers", value: users.length, subKey: "activeUsers", subCount: activeUsers, showRatio: true, href: "/admin/users" },
  ] as const;

  const quickLinks = [
    { href: "/admin/providers", titleKey: "linkProvidersTitle", descKey: "linkProvidersDesc" },
    { href: "/admin/models", titleKey: "linkModelsTitle", descKey: "linkModelsDesc" },
    { href: "/admin/users", titleKey: "linkUsersTitle", descKey: "linkUsersDesc" },
    { href: "/admin/usage", titleKey: "linkUsageTitle", descKey: "linkUsageDesc" },
  ] as const;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-ui-heading font-bold tracking-tight text-neutral-900 ">{t("title")}</h1>
        <p className="mt-1 text-ui-body text-neutral-500">{t("desc")}</p>
      </div>

      {/* 网关状态条:单一容器 + 发丝线分格,避免指标卡模板感;hover 显现跳转箭头;启用占比以细仪表条表达 */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-morning-mist bg-morning-mist sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.labelKey}
            href={s.href}
            className="group block bg-white p-5 transition-colors duration-200 hover:bg-nebula-silver/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui-caption font-medium text-ink-tertiary transition-colors group-hover:text-sora-blue">{t(s.labelKey)}</span>
              <ArrowRight className="h-3.5 w-3.5 text-ink-tertiary opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true" />
            </div>
            <div className="mt-3 text-ui-display font-semibold tracking-tight text-neutral-900  font-mono">{s.value}</div>
            <div className="mt-1.5 text-ui-caption text-ink-secondary">{t(s.subKey, { count: s.subCount })}</div>
            {s.showRatio && s.value > 0 && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-nebula-silver" role="presentation">
                <div className="h-full rounded-full bg-sora-blue/70" style={{ width: `${Math.round((s.subCount / s.value) * 100)}%` }} />
              </div>
            )}
          </Link>
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="text-ui-title font-semibold text-neutral-900 ">{t("quickLinks")}</h2>
        {/* 目录式入口行:图标沿用侧栏词汇(Server/Boxes/Users/BarChart3),箭头位移表达可跳转 */}
        <div className="overflow-hidden rounded-lg border border-morning-mist bg-white">
          {quickLinks.map((q, i) => {
            const Icon = QUICK_LINK_ICONS[i];
            return (
              <Link
                key={q.href}
                href={q.href}
                className="group flex items-center gap-4 border-t border-morning-mist px-5 py-4 transition-colors duration-200 first:border-t-0 hover:bg-nebula-silver/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-nebula-silver text-ink-secondary transition-colors duration-200 group-hover:bg-sora-blue/[0.08] group-hover:text-sora-blue">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-body font-semibold text-neutral-800 ">{t(q.titleKey)}</span>
                  <span className="mt-0.5 block text-ui-caption text-ink-tertiary leading-relaxed">{t(q.descKey)}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-sora-blue" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-sora-blue/20 bg-sora-blue/[0.04] p-4 text-ui-caption text-ink-secondary leading-relaxed flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-sora-blue shrink-0"></span>
        <span>
          {t.rich("gatewayHint", {
            base: (chunks) => <code className="font-mono bg-neutral-100  px-1 py-0.5 rounded text-neutral-700 ">{chunks}</code>,
            link: (chunks) => <Link href="/panel/keys" className="text-sora-blue hover:text-sora-blue-hover mx-1 font-medium underline underline-offset-2">{chunks}</Link>,
          })}
        </span>
      </div>
    </div>
  );
}
