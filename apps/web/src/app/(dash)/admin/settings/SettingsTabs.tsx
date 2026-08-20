import Link from "next/link";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";

export type SettingsTab =
  | "basic"
  | "model"
  | "output-modes"
  | "render-styles"
  | "governance";

interface SettingsTabsProps {
  current: SettingsTab;
}

/**
 * 系统设置二级 Tab —— 基础设置 / 模型配置 / 输出模式 / 输出样式 / 请求治理。
 * 纯链接(无 "use client"),点击走 ?tab= 触发服务端重新渲染(与 UsageTabs 同模式)。
 */
export function SettingsTabs({ current }: SettingsTabsProps) {
  const t = useTranslations("admin.settings.tabs");
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "basic", label: t("basic") },
    { id: "model", label: t("model") },
    { id: "output-modes", label: t("outputModes") },
    { id: "render-styles", label: t("renderStyles") },
    { id: "governance", label: t("governance") },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label={t("ariaLabel")}>
      {tabs.map(({ id, label }) => {
        const active = current === id;
        return (
          <Link
            key={id}
            href={`/admin/settings?tab=${id}`}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "touch-target max-w-full rounded-md border px-4 py-2 text-center text-ui-body font-medium whitespace-normal transition-colors duration-150",
              active
                ? "bg-sora-blue/8 text-deep-space border-sora-blue/30  "
                : "bg-nebula-white  text-neutral-500 border-morning-mist  hover:text-neutral-700 ",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default SettingsTabs;
