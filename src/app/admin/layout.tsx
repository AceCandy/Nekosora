import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { adminNavGroups } from "@/shared/nav-config";
import AppShell from "@/shared/components/AppShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const t = await getTranslations("panel");
  const tc = await getTranslations("nav");
  const ta = await getTranslations("admin.users");

  return (
    <AppShell
      user={user}
      groups={adminNavGroups()}
      brandHref="/admin"
      brandBadge={ta("roleAdmin")}
      matchMode="prefix"
      footerLinks={[
        { href: "/chat", label: t("enterChat") },
        { href: "/panel/keys", label: tc("panel") },
      ]}
    >
      {children}
    </AppShell>
  );
}
