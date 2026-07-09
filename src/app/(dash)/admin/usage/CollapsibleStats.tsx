"use client";
/**
 * 统计区折叠壳 —— 包裹 UsageDashboard,提供收起/展开 + localStorage 持久。
 *
 * SSR 安全:用 useSyncExternalStore 读持久折叠态 —— server snapshot 恒为 false(默认展开),
 * client 首次 snapshot 若不同由 React 安全重渲染(不触发 hydration mismatch);
 * 且避免 useEffect 内同步 setState(react-hooks/set-state-in-effect 规则)。
 * toggle 通过 override 覆盖持久值并写回 localStorage。
 */
import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";

const STORAGE_KEY = "usage-stats-collapsed";

/** 空订阅:折叠态仅本组件用,无需跨组件广播;持久值在 mount 读一次,toggle 后靠 override。 */
const emptySubscribe = () => () => {};

/** 读持久折叠态(client);SSR 用 getServerSnapshot 返回 false(默认展开)。 */
function readPersisted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function CollapsibleStats({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.usage");
  const persisted = useSyncExternalStore(emptySubscribe, readPersisted, () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? persisted;

  const toggle = () => {
    const next = !collapsed;
    setOverride(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* 忽略写入失败 */
    }
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] shadow-none">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex items-center justify-between w-full px-4 py-2.5 text-left hover:bg-neutral-50/60 dark:hover:bg-neutral-900/20 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t("statsOverview")}
        </span>
        <ChevronDown className={clsx("size-4 text-neutral-400 transition-transform duration-200", !collapsed && "rotate-180")} />
      </button>
      {!collapsed && <div className="border-t border-neutral-100 dark:border-neutral-800 p-5">{children}</div>}
    </div>
  );
}

export default CollapsibleStats;
