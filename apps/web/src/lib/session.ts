/** 会话辅助 —— 在 Server Components / Route Handlers 中读取当前登录用户。 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionFromHeaders, type SessionUser } from "@/lib/session-request";

export type { SessionUser } from "@/lib/session-request";

/** 获取当前会话(未登录返回 null)。 */
export async function getSession(): Promise<SessionUser | null> {
  return getSessionFromHeaders(await headers());
}

/** 获取当前会话,未登录则重定向到登录页。 */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** 要求管理员,否则重定向。 */
export async function requireAdmin(): Promise<SessionUser> {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/");
  return s;
}
