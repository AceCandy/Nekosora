import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { signOut } from "@/lib/auth-client";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import AdminSidebarNav from "./AdminSidebarNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const t = await getTranslations("panel");
  const tc = await getTranslations("nav");
  const ta = await getTranslations("admin.users");

  return (
    <div className="flex min-h-screen bg-[#fcfdff] text-[#0f121a] dark:bg-[#0d0f14] dark:text-[#f1f3f7] transition-colors duration-200">
      <aside className="w-56 border-r border-morning-mist dark:border-deep-space p-4 flex flex-col justify-between">
        <div className="space-y-6">
          <div className="px-3 py-2">
            <Link href="/admin" className="font-bold text-lg tracking-tight text-neutral-900 dark:text-white block hover:opacity-80 transition-opacity">
              Nekusora
            </Link>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono mt-0.5 truncate">
              {user.email} ({ta("roleAdmin")})
            </div>
          </div>
          <AdminSidebarNav />
        </div>

        <div className="pt-4 border-t border-morning-mist dark:border-deep-space space-y-2">
          <LanguageSwitcher className="block rounded-md px-3 py-2" />
          <Link
            href="/chat"
            className="block rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-900/50 transition-all duration-150"
          >
            {t("enterChat")}
          </Link>
          <Link
            href="/panel/keys"
            className="block rounded-md px-3 py-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all duration-150"
          >
            {tc("panel")}
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut();
              redirect("/login");
            }}
          >
            <button className="block w-full text-left rounded-md px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all duration-150">
              {tc("logout")}
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
