import { listUsers, toggleUserStatus } from "../actions";
import { getTranslations } from "next-intl/server";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";

export default async function UsersPage() {
  const users = await listUsers();
  const t = await getTranslations("admin.users");
  const tn = await getTranslations("nav");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">{tn("users")}</h1>

      <div className="rounded-lg border border-morning-mist bg-nebula-white dark:border-deep-space dark:bg-twilight-obsidian overflow-hidden shadow-none transition-all duration-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-morning-mist text-neutral-500 dark:bg-neutral-900/50 dark:border-deep-space dark:text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                <th className="text-left px-5 py-3 font-semibold">{t("thEmail")}</th>
                <th className="text-left px-5 py-3 font-semibold">{t("thName")}</th>
                <th className="text-left px-5 py-3 font-semibold">{t("thRole")}</th>
                <th className="text-left px-5 py-3 font-semibold">{t("thStatus")}</th>
                <th className="text-right px-5 py-3 font-semibold">{t("thActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-deep-space">
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-neutral-400 dark:text-neutral-500">
                    {t("empty")}
                  </td>
                </tr>
              )}
              {users.map((u: Record<string, unknown>) => (
                <tr 
                  key={u.id as string} 
                  className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                >
                  <td className="px-5 py-3.5 font-medium text-neutral-900 dark:text-white font-mono text-xs">
                    {u.email as string}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700 dark:text-neutral-300">
                    {u.name as string}
                  </td>
                  <td className="px-5 py-3.5">
                    {u.role === "admin" ? (
                      <Badge variant="primary" className="rounded-full px-2 py-0.5 text-xs font-semibold">
                        {t("roleAdminLabel")}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" className="rounded-full px-2 py-0.5 text-xs">
                        {t("roleUserLabel")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusDot enabled={u.status === "active"} label={u.status === "active" ? t("statusActive") : t("statusDisabled")} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {u.role !== "admin" ? (
                      <form
                        action={toggleUserStatus.bind(null, u.id as string, u.status === "active" ? "disabled" : "active")}
                        className="inline"
                      >
                        <Button type="submit" variant="secondary" size="sm" className="font-semibold">
                          {u.status === "active" ? t("actionDisable") : t("actionEnable")}
                        </Button>
                      </form>
                    ) : (
                      <span className="text-xs text-neutral-400 dark:text-neutral-600 select-none">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-4 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/20 dark:text-neutral-500 leading-relaxed">
        {t("footerNote")}
      </div>
    </div>
  );
}
