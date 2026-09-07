"use client";

import { useTranslations } from "next-intl";

/** 图表默认收起，让查询与明细占据首屏；展开状态由浏览器管理。 */
export function CollapsibleStats({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.usage");
  return (
    <details className="border-t border-morning-mist pt-3">
      <summary className="touch-target cursor-pointer rounded-md py-2 text-ui-body font-medium text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue">
        {t("statsOverview")}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

export default CollapsibleStats;
