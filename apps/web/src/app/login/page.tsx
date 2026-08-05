import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

/**
 * 登录页：已登录用户直接进入聊天首页，避免重复展示登录表单。
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/chat");
  return <LoginForm />;
}
