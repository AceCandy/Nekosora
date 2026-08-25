import { listUsers, toggleUserStatus } from "../actions";
import { getTranslations } from "next-intl/server";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";
import StatusSwitch from "@/shared/ui/StatusSwitch";
import { Users } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";
import DeleteUserButton from "./DeleteUserButton";

export default async function UsersPage() {
  const users = await listUsers();
  const t = await getTranslations("admin.users");
  const tn = await getTranslations("nav");

  return (
    <div className="space-y-6">
      <PageHeader icon={Users} title={tn("users")} desc={t("desc")} />

      <div className="rounded-lg border border-morning-mist bg-nebula-white   overflow-hidden shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-ui-body border-collapse">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-morning-mist text-neutral-500    text-ui-caption uppercase tracking-wider font-semibold">
                <th className="text-left px-5 py-3 font-semibold">{t("thEmail")}</th>
                <th className="text-left px-5 py-3 font-semibold">{t("thName")}</th>
                <th className="text-left px-5 py-3 font-semibold">{t("thRole")}</th>
                <th className="text-left px-5 py-3 font-semibold">{t("thStatus")}</th>
                <th className="text-right px-5 py-3 font-semibold">{t("thActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 ">
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-neutral-400 ">
                    {t("empty")}
                  </td>
                </tr>
              )}
              {users.map((u: Record<string, unknown>) => (
                <tr 
                  key={u.id as string} 
                  className="hover:bg-neutral-50/30  transition-colors duration-150"
                >
                  <td className="px-5 py-3.5 font-medium text-neutral-900  font-mono text-ui-caption">
                    {u.email as string}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700 ">
                    {u.name as string}
                  </td>
                  <td className="px-5 py-3.5">
                    {u.role === "admin" ? (
                      <Badge variant="primary" className="rounded-full px-2 py-0.5 text-ui-caption font-semibold">
                        {t("roleAdminLabel")}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" className="rounded-full px-2 py-0.5 text-ui-caption">
                        {t("roleUserLabel")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {u.role !== "admin" ? (
                      <form
                        action={toggleUserStatus.bind(null, u.id as string, u.status === "active" ? "disabled" : "active")}
                        className="inline-block"
                      >
                        <StatusSwitch
                          type="submit"
                          checked={u.status === "active"}
                          label={u.status === "active" ? t("actionDisable") : t("actionEnable")}
                        />
                      </form>
                    ) : (
                      <StatusDot
                        enabled={u.status === "active"}
                        label={u.status === "active" ? t("statusActive") : t("statusDisabled")}
                      />
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {!u.isCurrent && (
                      <DeleteUserButton
                        userId={u.id as string}
                        displayName={(u.name || u.email) as string}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-4 text-ui-caption text-neutral-500    leading-relaxed">
        {t("footerNote")}
      </div>
    </div>
  );
}
