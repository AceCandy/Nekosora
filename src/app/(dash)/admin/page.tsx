import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listProviders, listModels, listRoutes, listUsers } from "./actions";

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
  const stats = [
    { labelKey: "statProviders", value: providers.length, subKey: "enabled", subCount: enabledProviders, href: "/admin/providers" },
    { labelKey: "statModels", value: models.length, subKey: "enabled", subCount: enabledModels, href: "/admin/models" },
    { labelKey: "statRoutes", value: routes.length, subKey: "routesSub", subCount: 0, href: "/admin/models" },
    { labelKey: "statUsers", value: users.length, subKey: "activeUsers", subCount: activeUsers, href: "/admin/users" },
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
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("desc")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.labelKey}
            href={s.href}
            className="group block rounded-lg border border-morning-mist bg-white p-5 hover:border-sora-blue/30 hover:bg-neutral-50/50 dark:border-deep-space dark:bg-twilight-obsidian dark:hover:border-sora-blue/20 dark:hover:bg-neutral-900/30 transition-all duration-200 shadow-none hover:shadow-[0_4px_12px_rgba(0,0,0,0.03)]"
          >
            <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500 group-hover:text-sora-blue transition-colors">{t(s.labelKey)}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-white font-mono">{s.value}</div>
            <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{t(s.subKey, { count: s.subCount })}</div>
          </Link>
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{t("quickLinks")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {quickLinks.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="block rounded-lg border border-morning-mist bg-white p-5 hover:border-sora-blue/30 hover:bg-neutral-50/50 dark:border-deep-space dark:bg-twilight-obsidian dark:hover:border-sora-blue/20 dark:hover:bg-neutral-900/30 transition-all duration-200 shadow-none hover:shadow-[0_4px_12px_rgba(0,0,0,0.03)]"
            >
              <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t(q.titleKey)}</div>
              <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed">{t(q.descKey)}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/10 bg-blue-50/30 dark:bg-blue-950/10 p-4 text-xs text-blue-800 dark:text-blue-200 leading-relaxed flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
        <span>
          {t.rich("gatewayHint", {
            base: (chunks) => <code className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-700 dark:text-neutral-300">{chunks}</code>,
            link: (chunks) => <Link href="/panel/keys" className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 mx-1 font-medium underline underline-offset-2">{chunks}</Link>,
          })}
        </span>
      </div>
    </div>
  );
}
