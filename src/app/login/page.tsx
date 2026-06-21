"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn.email({ email, password });
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? "登录失败，请检查您的账号与密码");
      return;
    }
    router.push("/chat");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#fcfdff] text-[#0f121a] dark:bg-[#0d0f14] dark:text-[#f1f3f7] p-6 transition-colors duration-200 overflow-hidden">
      {/* 天空冷调柔光背景 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.03),transparent_50%)] dark:bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.05),transparent_50%)]" />

      <div className="relative z-10 w-full max-w-[400px] space-y-6">
        <div className="text-center space-y-1">
          <Link href="/" className="inline-block text-3xl font-extrabold tracking-tight text-neutral-950 dark:text-white">
            Nekusora
          </Link>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 font-medium">登录到平台管理后台</p>
        </div>

        <div className="rounded-lg border border-morning-mist bg-white p-6 dark:border-deep-space dark:bg-twilight-obsidian shadow-none">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400">电子邮箱</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@nekusora.local"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400">安全密码</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-500/10 bg-red-50/50 p-3 text-xs text-red-600 dark:bg-red-950/20 dark:text-red-400 leading-relaxed">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              className="w-full"
            >
              安全登录
            </Button>
          </form>
        </div>

        <div className="text-center">
          <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors">
            ← 返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
