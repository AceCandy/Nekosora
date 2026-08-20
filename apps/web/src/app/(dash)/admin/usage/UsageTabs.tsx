import Link from "next/link";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";

interface UsageTabsProps {
  /** 当前激活 Tab。 */
  current: "usage" | "errors";
  /** 页面根路径(/admin/usage 或 /panel/usage)。 */
  basePath: string;
  /** 当前时间范围(切换 Tab 时保留)。 */
  range?: string;
}

/**
 * 用量页双 Tab —— 用量明细 / 错误请求。纯链接(无 "use client"),
 * 点击 Tab 跳转触发服务端重新查询。切换时重置 page=1、丢弃明细筛选,
 * 仅保留 range。
 */
export function UsageTabs({ current, basePath, range }: UsageTabsProps) {
  const t = useTranslations("admin.usage");
  const buildHref = (tab: "usage" | "errors") => {
    const params = new URLSearchParams();
    if (range !== undefined) params.set("range", range);
    params.set("tab", tab);
    return `${basePath}?${params.toString()}`;
  };
  const tab = (id: "usage" | "errors", label: string) => {
    const active = current === id;
    return (
      <Link
        href={buildHref(id)}
        prefetch={false}
        className={clsx(
          "px-4 py-2 rounded-md text-ui-body font-medium transition-colors duration-150 border",
          active
            ? "bg-sora-blue/8 text-sora-blue border-sora-blue/30 "
            : "bg-nebula-white  text-neutral-500 border-morning-mist  hover:text-neutral-700 ",
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex items-center gap-2">
      {tab("usage", t("tabs.usage"))}
      {tab("errors", t("tabs.errors"))}
    </div>
  );
}

export default UsageTabs;
