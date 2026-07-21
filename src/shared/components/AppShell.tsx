import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth";
import type { SessionUser } from "@/lib/session";
import type { NavGroup } from "@/shared/nav-config";
import DashSidebar from "@/shared/components/DashSidebar";

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

/** 登出 server action:走 auth.api.signOut + headers,统一 client/服务端入口。 */
async function logoutAction() {
  "use server";
  const auth = await getAuth();
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

/**
 * 配置后台共享 shell(server component)。
 *
 * 统一 /panel 与 /admin 的视觉壳:相同的壳根、品牌区、分组导航、底栏与登出,
 * 差异完全由 props(groups / brandHref / brandBadge / footerLinks)驱动。
 * 侧栏交互(收起)下沉到 client 组件 DashSidebar,登出 server action 在此定义后透传。
 */
export default function AppShell({
  user,
  groups,
  brandHref,
  brandBadge,
  matchMode = "exact",
  footerLinks = [],
  children,
}: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-[#fcfdff] text-[#0f121a] transition-colors duration-200 dark:bg-[#0d0f14] dark:text-[#f1f3f7] md:flex-row">
      <DashSidebar
        user={user}
        groups={groups}
        brandHref={brandHref}
        brandBadge={brandBadge}
        matchMode={matchMode}
        footerLinks={footerLinks}
        logoutAction={logoutAction}
      />
      <main id="dash-main-content" className="scroll-fade-y min-h-0 flex-1 overflow-auto p-4 sm:p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
