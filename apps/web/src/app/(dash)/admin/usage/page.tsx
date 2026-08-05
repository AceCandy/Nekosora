import { redirect } from "next/navigation";

/**
 * /admin/usage 已并入 /panel/usage(用量查询合一,一套页面按权限做数据隔离)。
 * 保留本路由作重定向入口,兼容旧书签 / 外链,query 原样透传。
 * admin 默认查自己、可切换「全部用户」、普通用户强制查自己的逻辑由 /panel/usage 承载。
 */
export default async function AdminUsageRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") params.set(k, v);
  }
  const qs = params.toString();
  redirect(`/panel/usage${qs ? `?${qs}` : ""}`);
}
