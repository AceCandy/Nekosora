"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { useClickOutside } from "@/shared/lib/useClickOutside";

export type SettingsTab = "models" | "output" | "governance" | "protocol";

interface SettingsTabsProps {
  current: SettingsTab;
}

const TAB_ITEMS = [
  { id: "models", key: "tabs.models" },
  { id: "output", key: "tabs.output" },
  { id: "governance", key: "tabs.governance" },
  { id: "protocol", key: "tabs.protocol" },
] as const satisfies readonly { id: SettingsTab; key: string }[];

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
  const searchRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const tabs = TAB_ITEMS.map((item) => ({ id: item.id, label: t(item.key) }));
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return SEARCH_ITEMS.filter((item) => (
      `${t(item.key)} ${item.words}`.toLowerCase().includes(normalized)
    ));
  }, [query, t]);
  const visible = open && Boolean(query.trim());
  const activeResult = visible ? results[activeIndex] : undefined;
  useClickOutside(searchRef, () => setOpen(false), visible);

  const selectResult = (index: number) => {
    const item = results[index];
    if (!item) return;
    setQuery("");
    setOpen(false);
    router.push(`/admin/settings?tab=${item.tab}#${item.anchor}`);
  };

  return (
    <div className="space-y-3 border-b border-morning-mist pb-4">
      <div ref={searchRef} className="relative max-w-xl">
        <label htmlFor="settings-search" className="sr-only">{t("searchLabel")}</label>
        <input
          id="settings-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={listboxId}
          aria-activedescendant={activeResult ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            setOpen(Boolean(value.trim()));
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(Boolean(query.trim()))}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (results.length === 0) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => (
                event.key === "ArrowDown"
                  ? (index + 1) % results.length
                  : (index - 1 + results.length) % results.length
              ));
              return;
            }
            if (event.key === "Enter" && visible) {
              event.preventDefault();
              selectResult(activeIndex);
            }
          }}
          placeholder={t("searchPlaceholder")}
          className="touch-target w-full rounded-md border border-morning-mist bg-nebula-white px-3 py-2 text-ui-body text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40"
        />
        {visible && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-morning-mist bg-nebula-white p-1"
          >
            {results.length === 0 ? (
              <p role="status" className="px-3 py-2 text-ui-body text-neutral-500">{t("searchEmpty")}</p>
            ) : results.map((item, index) => (
              <Link
                key={item.anchor}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                href={`/admin/settings?tab=${item.tab}#${item.anchor}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                }}
                className={clsx(
                  "block rounded px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40",
                  activeIndex === index ? "bg-neutral-50" : "hover:bg-neutral-50",
                )}
              >
                <span className="block text-ui-caption text-ink-tertiary">
                  {tabs.find((tab) => tab.id === item.tab)?.label}
                </span>
                <span className="block text-ui-body font-medium text-neutral-700">{t(item.key)}</span>
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
