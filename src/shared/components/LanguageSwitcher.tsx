"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { clsx } from "clsx";
import { setLocale } from "@/i18n/actions";
import type { Locale } from "@/i18n/request";

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "zh-CN", label: "中文" },
  { value: "en", label: "English" },
];

/**
 * 语言切换器 —— 下拉选择,写 cookie 后整页刷新。
 *
 * 放在 panel/admin layout 的侧边栏底部(与 logout 同区)。
 * 切换后 setLocale server action 写 cookie + revalidatePath,
 * 页面自动重渲染为新 locale。
 */
export default function LanguageSwitcher({ className }: { className?: string }) {
  const current = useLocale() as Locale;
  const t = useTranslations("common");
  const [isPending, startTransition] = useTransition();

  const handleChange = (locale: Locale) => {
    if (locale === current) return;
    startTransition(async () => {
      await setLocale(locale);
    });
  };

  return (
    <div className={clsx("relative inline-flex items-center", className)}>
      <Globe className="w-3.5 h-3.5 text-neutral-400 mr-1.5 pointer-events-none" />
      <select
        value={current}
        onChange={(e) => handleChange(e.target.value as Locale)}
        disabled={isPending}
        aria-label={t("language")}
        className="appearance-none bg-transparent text-ui-body font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 cursor-pointer disabled:opacity-50 pr-1"
      >
        {LOCALE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
