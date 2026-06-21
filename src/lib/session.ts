/** 会话辅助 —— 在 Server Components / Route Handlers 中读取当前登录用户。 */
import { headers } from "next/headers";
import { getAuth } from "@/auth";
import { redirect } from "next/navigation";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

/** 获取当前会话(未登录返回 null)。 */
export async function getSession(): Promise<SessionUser | null> {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;
    const u = session.user as Record<string, unknown>;
    return {
      id: u.id as string,
      email: u.email as string,
      name: u.name as string,
      role: (u.role as string) ?? "user",
      status: (u.status as string) ?? "active",
    };
  } catch {
    return null;
  }
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
