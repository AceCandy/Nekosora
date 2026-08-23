"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";
import SkyAtmosphere from "@/shared/components/SkyAtmosphere";
import StarChart, { StarChartStrip } from "./StarChart";

/** 登录表单：提交成功后进入聊天首页。 */
export default function LoginForm() {
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
    <main className="flex min-h-screen bg-nebula-white text-space-ink">
      {/* 品牌天幕(仅 md+ 显示):天空氛围层 + 天际线 motif + 大字品牌宣言,与右侧纯净表单构成「双面平衡」 */}
      <section className="relative hidden select-none flex-col justify-between overflow-hidden p-10 md:flex md:w-[54%] lg:w-[56%] lg:p-14">
        <SkyAtmosphere stars={24} seed={20260821} shootingStar />
        <StarChart />
        <div className="welcome-rise relative">
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue focus-visible:ring-offset-2 focus-visible:ring-offset-nebula-white"
          >
            <Image src="/icon.svg" alt="" width={36} height={36} className="brightness-0" priority />
            <span className="text-ui-title font-bold tracking-tight text-neutral-950">Nekusora</span>
          </Link>
        </div>
        <div className="welcome-rise relative space-y-6" style={{ animationDelay: "140ms" }}>
          {/* 天际线 motif:一条渐隐发线 + 锚点星,把「星枢天流」落成具象构图;纯装饰 */}
          <div aria-hidden="true" className="relative h-px w-44 bg-gradient-to-r from-sora-blue/40 via-morning-mist to-transparent">
            <span className="absolute -top-[2px] left-0 h-[5px] w-[5px] rounded-full bg-sora-blue/60" />
            <span className="star-twinkle absolute -top-[1px] left-24 h-[3px] w-[3px] rounded-full bg-sora-blue/50" />
            <span className="star-twinkle absolute -top-[1px] right-6 h-[3px] w-[3px] rounded-full bg-space-ink/40" style={{ animationDelay: "1.6s" }} />
          </div>
          <h1 className="text-[clamp(3rem,4.6vw,4.5rem)] font-extrabold tracking-[-0.03em] leading-[1.06] text-neutral-950 [text-wrap:balance]">
            {t("brandTitle")}
          </h1>
          <p className="max-w-[36ch] text-ui-reading leading-7 text-ink-secondary">{t("brandDesc")}</p>
        </div>
      </section>

      {/* 表单区:纯白静面,无边框卡片,依靠字重与节奏分层;md+ 以晨雾细线划分品牌区,立住分割秩序 */}
      <section className="relative flex flex-1 items-center justify-center p-6 md:border-l md:border-morning-mist/70">
        {/* 移动端降级星图横带:品牌区隐藏时补位,只在小屏挂载 */}
        <div className="md:hidden">
          <StarChartStrip />
        </div>
        <div className="w-full max-w-[360px]">
          <div className="welcome-rise mb-10 flex flex-col items-center gap-4 md:hidden">
            <Image src="/icon.svg" alt="" width={48} height={48} className="brightness-0" priority />
            <span className="text-ui-title font-bold tracking-tight text-neutral-950">Nekusora</span>
          </div>

          {/* 视觉上去掉表单标题(按钮已自明),仅保留屏幕阅读器可及的语义标题 */}
          <h2 className="sr-only">{t("title")}</h2>

          <form onSubmit={handleSubmit} className="welcome-rise space-y-5" style={{ animationDelay: "140ms" }}>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-ui-caption font-semibold text-neutral-600 ">{t("email")}</label>
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
                className="hover:border-neutral-300"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-ui-caption font-semibold text-neutral-600 ">{t("password")}</label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
                className="hover:border-neutral-300"
              />
            </div>

            {error && (
              <div id="login-error" role="alert" aria-live="polite" className="error-shake rounded-md border border-danger/15 bg-danger/[0.05] p-3 text-ui-caption leading-relaxed text-danger  ">
                {error}
              </div>
            )}

            {/* 主按钮:hover 上浮 + 星轨悬浮(DESIGN.md §5 仅 hover 态允许投影) */}
            <Button
              type="submit"
              variant="primary"
              loading={loading}
              className="w-full hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] active:translate-y-0 motion-reduce:hover:transform-none"
            >
              {t("submit")}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
