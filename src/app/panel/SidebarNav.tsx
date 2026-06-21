"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";

// href + nav 字典 key(label 运行时按 locale 渲染)。
const navItems = [
  { href: "/panel/keys", labelKey: "keys" },
  { href: "/panel/providers", labelKey: "providers" },
  { href: "/panel/models", labelKey: "models" },
  { href: "/panel/templates", labelKey: "templates" },
  { href: "/panel/cards", labelKey: "cards" },
  { href: "/panel/memory", labelKey: "memory" },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.getAttribute("contenteditable") === "true");

      if (isInput) return;

      if (["1", "2", "3", "4", "5"].includes(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const targetItem = navItems[index];
        if (targetItem) {
          router.push(targetItem.href);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <nav className="space-y-1">
      {navItems.map((item, index) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-all duration-155 ease-out group/nav",
              isActive
                ? "bg-sora-blue/8 text-sora-blue dark:bg-sora-blue/10"
                : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-900/50"
            )}
          >
            <span>{t(item.labelKey)}</span>
            <span className="hidden sm:inline-block text-[10px] font-mono border border-neutral-200 dark:border-neutral-800 rounded px-1.5 py-0.5 text-neutral-400 dark:text-neutral-500 opacity-0 group-hover/nav:opacity-100 transition-opacity">
              {index + 1}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
