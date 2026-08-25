"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import type { SettingsSelection, SettingsSubview, SettingsTab } from "./settings-selection";

const TAB_ITEMS = [
  { id: "models", key: "tabs.models" },
  { id: "output", key: "tabs.output" },
  { id: "governance", key: "tabs.governance" },
  { id: "protocol", key: "tabs.protocol" },
] as const satisfies readonly { id: SettingsTab; key: string }[];

const TAB_HREFS: Record<SettingsTab, string> = {
  models: "/admin/settings?tab=models",
  output: "/admin/settings?tab=output&view=modes",
  governance: "/admin/settings?tab=governance&view=policy",
  protocol: "/admin/settings?tab=protocol",
};

export function SettingsTabs({ tab: current, view }: SettingsSelection) {
  const t = useTranslations("admin.settings");
  const router = useRouter();

  return (
    <div className="space-y-3">
      <nav className="hidden border-b border-morning-mist sm:flex" aria-label={t("tabs.ariaLabel")}>
        {TAB_ITEMS.map(({ id, key }) => (
          <Link
            key={id}
            href={TAB_HREFS[id]}
            prefetch={false}
            aria-current={current === id ? "page" : undefined}
            className={clsx(
              "touch-target -mb-px border-b-2 px-4 py-2.5 text-center text-ui-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40",
              current === id
                ? "border-sora-blue text-deep-space"
                : "border-transparent text-neutral-500 hover:text-neutral-700",
            )}
          >
            {t(key)}
          </Link>
        ))}
      </nav>

      <label className="block sm:hidden">
        <span className="mb-1 block text-ui-caption font-medium text-neutral-600">
          {t("tabs.ariaLabel")}
        </span>
        <select
          value={current}
          onChange={(event) => router.push(TAB_HREFS[event.target.value as SettingsTab])}
          className="touch-target w-full rounded-md border border-morning-mist bg-nebula-white px-3 py-2 text-ui-body text-space-ink"
        >
          {TAB_ITEMS.map(({ id, key }) => <option key={id} value={id}>{t(key)}</option>)}
        </select>
      </label>

      {current === "output" && (
        <SubviewTabs
          label={t("tabs.outputAriaLabel")}
          current={view ?? "modes"}
          items={[
            { id: "modes", href: TAB_HREFS.output, label: t("tabs.outputModes") },
            { id: "styles", href: "/admin/settings?tab=output&view=styles", label: t("tabs.renderStyles") },
          ]}
        />
      )}
      {current === "governance" && (
        <SubviewTabs
          label={t("tabs.governanceAriaLabel")}
          current={view ?? "policy"}
          items={[
            { id: "policy", href: TAB_HREFS.governance, label: t("tabs.governancePolicy") },
            { id: "history", href: "/admin/settings?tab=governance&view=history", label: t("tabs.governanceHistory") },
          ]}
        />
      )}
    </div>
  );
}

function SubviewTabs({
  label,
  current,
  items,
}: {
  label: string;
  current: SettingsSubview;
  items: { id: SettingsSubview; href: string; label: string }[];
}) {
  return (
    <nav aria-label={label} className="flex gap-1 rounded-md bg-neutral-50 p-1">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          prefetch={false}
          aria-current={current === item.id ? "page" : undefined}
          className={clsx(
            "touch-target rounded px-3 py-2 text-ui-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40",
            current === item.id
              ? "bg-nebula-white text-deep-space"
              : "text-neutral-500 hover:text-neutral-700",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export default SettingsTabs;
