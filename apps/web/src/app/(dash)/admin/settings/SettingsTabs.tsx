"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";

export type SettingsTab = "models" | "output" | "governance" | "protocol";

interface SettingsTabsProps {
  current: SettingsTab;
}

const SEARCH_ITEMS = [
  { tab: "models", anchor: "embedding-model", key: "embeddingModel", words: "embedding 向量 嵌入" },
  { tab: "models", anchor: "title-model-id", key: "titleTaskTitle", words: "title 标题" },
  { tab: "models", anchor: "compact-model-id", key: "compactTaskTitle", words: "summary compact 摘要 压缩" },
  { tab: "models", anchor: "mem0-model-id", key: "mem0LlmTitle", words: "memory mem0 记忆" },
  { tab: "output", anchor: "output-modes", key: "tabs.outputModes", words: "prompt behavior 输出 模式 指令" },
  { tab: "output", anchor: "render-styles", key: "tabs.renderStyles", words: "css markdown renderer 样式 渲染" },
  { tab: "governance", anchor: "governance-policy", key: "tabs.governance", words: "rpm quota concurrency rate 限流 并发 额度" },
  { tab: "protocol", anchor: "gateway-user-agent", key: "basicTitle", words: "ua user-agent gateway chat 转发" },
] as const;

export function SettingsTabs({ current }: SettingsTabsProps) {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "models", label: t("tabs.models") },
    { id: "output", label: t("tabs.output") },
    { id: "governance", label: t("tabs.governance") },
    { id: "protocol", label: t("tabs.protocol") },
  ];
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return SEARCH_ITEMS.filter((item) => (
      `${t(item.key)} ${item.words}`.toLocaleLowerCase().includes(normalized)
    ));
  }, [query, t]);

  return (
    <div className="sticky top-0 z-10 space-y-3 border-b border-morning-mist bg-nebula-white py-3">
      <div className="relative max-w-xl">
        <label htmlFor="settings-search" className="sr-only">{t("searchLabel")}</label>
        <input
          id="settings-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="touch-target w-full rounded-md border border-morning-mist bg-nebula-white px-3 py-2 text-ui-body text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40"
        />
        {query.trim() && (
          <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-morning-mist bg-nebula-white p-1">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-ui-body text-neutral-500">{t("searchEmpty")}</p>
            ) : results.map((item) => (
              <Link
                key={item.anchor}
                href={`/admin/settings?tab=${item.tab}#${item.anchor}`}
                onClick={() => setQuery("")}
                className="block rounded px-3 py-2 text-ui-body text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40"
              >
                {t(item.key)}
              </Link>
            ))}
          </div>
        )}
      </div>

      <nav className="hidden items-center gap-2 sm:flex" aria-label={t("tabs.ariaLabel")}>
        {tabs.map(({ id, label }) => (
          <Link
            key={id}
            href={`/admin/settings?tab=${id}`}
            prefetch={false}
            aria-current={current === id ? "page" : undefined}
            className={clsx(
              "touch-target rounded-md border px-4 py-2 text-center text-ui-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40",
              current === id
                ? "border-sora-blue/30 bg-sora-blue/8 text-deep-space"
                : "border-morning-mist bg-nebula-white text-neutral-500 hover:text-neutral-700",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <label className="block sm:hidden">
        <span className="mb-1 block text-ui-caption font-medium text-neutral-600">
          {t("tabs.ariaLabel")}
        </span>
        <select
          value={current}
          onChange={(event) => router.push(`/admin/settings?tab=${event.target.value}`)}
          className="touch-target w-full rounded-md border border-morning-mist bg-nebula-white px-3 py-2 text-ui-body text-space-ink"
        >
          {tabs.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}

export default SettingsTabs;
