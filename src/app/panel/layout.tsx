import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { panelNavGroups } from "@/shared/nav-config";
import AppShell from "@/shared/components/AppShell";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const t = await getTranslations("panel");

  return (
    <AppShell
      user={user}
      groups={panelNavGroups(user.role)}
      brandHref="/panel"
      matchMode="exact"
      footerLinks={[{ href: "/chat", label: t("enterChat") }]}
    >
      {children}
    </AppShell>
  );
}
