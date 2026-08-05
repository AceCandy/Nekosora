import Link from "next/link";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";

export type SettingsTab = "basic" | "model" | "output-modes" | "render-styles";

interface SettingsTabsProps {
  current: SettingsTab;
}

/**
 * 系统设置二级 Tab —— 模型配置 / 输出模式 / 输出样式。
 * 纯链接(无 "use client"),点击走 ?tab= 触发服务端重新渲染(与 UsageTabs 同模式)。
 */
export function SettingsTabs({ current }: SettingsTabsProps) {
  const t = useTranslations("admin.settings.tabs");
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "basic", label: t("basic") },
    { id: "model", label: t("model") },
    { id: "output-modes", label: t("outputModes") },
    { id: "render-styles", label: t("renderStyles") },
  ];

  return (
    <div className="flex items-center gap-2">
      {tabs.map(({ id, label }) => {
        const active = current === id;
        return (
          <Link
            key={id}
            href={`/admin/settings?tab=${id}`}
            prefetch={false}
            className={clsx(
              "px-4 py-2 rounded-md text-ui-body font-medium transition-colors duration-150 border",
              active
                ? "bg-sora-blue/8 text-sora-blue border-sora-blue/30 dark:bg-sora-blue/10"
                : "bg-nebula-white dark:bg-twilight-obsidian text-neutral-500 border-morning-mist dark:border-deep-space hover:text-neutral-700 dark:hover:text-neutral-300",
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export default SettingsTabs;
