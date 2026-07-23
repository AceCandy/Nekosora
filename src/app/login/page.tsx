"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";

export default function LoginPage() {
  const t = useTranslations("login");
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
      setError(res.error.message ?? t("failed"));
      return;
    }
    router.push("/chat");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-nebula-white p-6 text-space-ink transition-colors duration-200 dark:bg-twilight-obsidian dark:text-nebula-silver">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.03),transparent_50%)] dark:bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.05),transparent_50%)]" />

      <div className="relative z-10 w-full max-w-[400px] space-y-6">
        <div className="text-center space-y-1">
          <Link href="/" className="inline-block rounded text-ui-display font-extrabold tracking-tight text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue focus-visible:ring-offset-2 focus-visible:ring-offset-nebula-white dark:text-white dark:focus-visible:ring-offset-twilight-obsidian">
            Nekusora
          </Link>
          <p className="text-ui-caption font-medium text-neutral-600 dark:text-neutral-400">{t("subtitle")}</p>
        </div>

        <div className="rounded-lg border border-morning-mist bg-white p-6 dark:border-deep-space dark:bg-twilight-obsidian shadow-none">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400">{t("email")}</label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@nekusora.local"
                autoComplete="email"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-ui-caption font-semibold text-neutral-600 dark:text-neutral-400">{t("password")}</label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            {error && (
              <div id="login-error" role="alert" aria-live="polite" className="rounded-md border border-red-500/10 bg-red-50/50 p-3 text-ui-caption leading-relaxed text-red-700 dark:bg-red-950/20 dark:text-red-300">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={loading}
              className="w-full"
            >
              {t("submit")}
            </Button>
          </form>
        </div>

        <div className="text-center">
          <Link href="/" className="rounded text-ui-caption text-neutral-600 transition-colors hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue focus-visible:ring-offset-2 focus-visible:ring-offset-nebula-white dark:text-neutral-400 dark:hover:text-neutral-200 dark:focus-visible:ring-offset-twilight-obsidian">
            ← {t("back")}
          </Link>
        </div>
      </div>
    </main>
  );
}
