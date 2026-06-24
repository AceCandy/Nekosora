import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth";
import type { SessionUser } from "@/lib/session";
import type { NavGroup } from "@/shared/nav-config";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import SidebarNav from "@/shared/components/SidebarNav";

export interface FooterLink {
  href: string;
  /** 已翻译好的文案(由调用方用 getTranslations 取得),AppShell 直接渲染。 */
  label: string;
}

interface AppShellProps {
  /** 当前会话用户(含 role),用于品牌区展示与登出。 */
  user: SessionUser;
  /** 分组导航数据。 */
  groups: NavGroup[];
  /** 品牌区点击跳转目标(panel 指向 /panel,admin 指向 /admin)。 */
  brandHref: string;
  /** 品牌区用户名后缀角标(如 admin 的「(管理员)」),不传则不渲染。 */
  brandBadge?: string;
  /** active 判定方式,透传给 SidebarNav。 */
  matchMode?: "exact" | "prefix";
  /** 底栏交叉链接(进入聊天、控制面板等),置于语言切换与登出之间。 */
  footerLinks?: FooterLink[];
  children: React.ReactNode;
}

/**
 * 配置后台共享 shell(server component)。
 *
 * 统一 /panel 与 /admin 的视觉壳:相同的壳根、品牌区、分组导航、底栏与登出,
 * 差异完全由 props(groups / brandHref / brandBadge / footerLinks)驱动。
 * 登出统一为 server action(走 auth.api.signOut + headers),避免 client/服务端两套实现。
 */
export default async function AppShell({
  user,
  groups,
  brandHref,
  brandBadge,
  matchMode = "exact",
  footerLinks = [],
  children,
}: AppShellProps) {
  const t = await getTranslations("nav");

  return (
    <div className="flex min-h-screen bg-[#fcfdff] text-[#0f121a] transition-colors duration-200 dark:bg-[#0d0f14] dark:text-[#f1f3f7]">
      <aside className="flex w-56 flex-col justify-between border-r border-morning-mist p-4 dark:border-deep-space">
        <div className="space-y-6">
          <div className="px-3 py-2">
            <Link
              href={brandHref}
              className="block text-lg font-bold tracking-tight text-neutral-900 transition-opacity hover:opacity-80 dark:text-white"
            >
              Nekusora
            </Link>
            <div className="mt-0.5 truncate font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
              {user.email}
              {brandBadge ? ` (${brandBadge})` : ""}
            </div>
          </div>
          <SidebarNav groups={groups} matchMode={matchMode} />
        </div>

        <div className="space-y-2 border-t border-morning-mist pt-4 dark:border-deep-space">
          <LanguageSwitcher className="block rounded-md px-3 py-2" />
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-all duration-150 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900/50 dark:hover:text-neutral-100"
            >
              {link.label}
            </Link>
          ))}
          <form
            action={async () => {
              "use server";
              const auth = await getAuth();
              await auth.api.signOut({ headers: await headers() });
              redirect("/login");
            }}
          >
            <button className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-500 transition-all duration-150 hover:bg-red-50 dark:hover:bg-red-950/20">
              {t("logout")}
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
