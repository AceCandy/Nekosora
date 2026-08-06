import { getAuth } from "@/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

/** 使用显式请求头读取会话，供 Next Route Handler 与独立 Gateway 共用。 */
export async function getSessionFromHeaders(headers: Headers): Promise<SessionUser | null> {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    if (!session?.user) return null;
    const user = session.user as Record<string, unknown>;
    if (user.status !== "active") return null;
    return {
      id: user.id as string,
      email: user.email as string,
      name: user.name as string,
      role: (user.role as string) ?? "user",
      status: user.status,
    };
  } catch {
    return null;
  }
}
