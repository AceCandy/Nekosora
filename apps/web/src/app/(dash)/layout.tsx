import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireSession, requireAdmin } from "@/lib/session";
import { panelNavGroups, adminNavGroups } from "@/shared/nav-config";
import AppShell from "@/shared/components/AppShell";

/**
 * 配置后台共享根 layout(panel + admin 同一棵 layout 树)。
 *
 * 为什么合并:原 panel/layout 与 admin/layout 各自渲染一个 AppShell,
 * 跨段导航(如 /panel 点「全局管理」跳 /admin)会卸载重建整棵 layout 树 → 体感跳转。
 * 合并后,React 在原位置 in-place 更新 AppShell 的 props,真正软切换。
 *
 * 分流依据:middleware 注入的 `x-pathname` header。server component 不能用
 * usePathname()(client hook),故通过 headers() 读取。
 *   - pathname 以 /admin 开头 → requireAdmin + admin 壳
 *   - 否则 → requireSession + panel 壳
 *
 * 段级守卫:此 layout 在导航时会作为 dynamic server component 重新执行(读 headers),
 * 故守卫始终生效,不会因 layout 不 unmount 而失效。
 */
export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");

  const user = isAdmin ? await requireAdmin() : await requireSession();

  const t = await getTranslations("panel");
  const ta = await getTranslations("admin.users");

  const groups = isAdmin ? adminNavGroups() : panelNavGroups(user.role);
  const brandHref = "/chat";
  const brandBadge = isAdmin ? ta("roleAdmin") : undefined;
  const matchMode = isAdmin ? ("prefix" as const) : ("exact" as const);
  const footerLinks = [{ href: "/chat", label: t("enterChat") }];

  return (
    <AppShell
      user={user}
      groups={groups}
      brandHref={brandHref}
      brandBadge={brandBadge}
      matchMode={matchMode}
      footerLinks={footerLinks}
    >
      {children}
    </AppShell>
  );
}
