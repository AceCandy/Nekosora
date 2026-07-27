"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2 } from "lucide-react";
import { unlockShare } from "@/features/chat/actions/share";

export function ShareUnlockForm({ shareId }: { shareId: string }) {
  const t = useTranslations("share");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setError(null);
    startTransition(async () => {
      const result = await unlockShare(shareId, password);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.reason === "rate_limited"
        ? t("rateLimited", { seconds: result.retryAfter ?? 60 })
        : t("invalidPassword"));
    });
  };

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-sm space-y-4">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"><KeyRound className="h-5 w-5" /></div>
      <div><h1 className="text-ui-title font-semibold">{t("passwordRequired")}</h1><p className="mt-1 text-ui-body text-neutral-500 dark:text-neutral-400">{t("passwordRequiredDescription")}</p></div>
      <label className="block space-y-1.5"><span className="text-ui-body font-medium">{t("password")}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus autoComplete="current-password" className="h-11 w-full rounded-lg border border-morning-mist bg-white px-3 text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:border-deep-space dark:bg-neutral-950" /></label>
      {error && <p role="alert" className="text-ui-caption text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={isPending || !password} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-sora-blue px-4 text-ui-body font-medium text-white hover:bg-blue-600 disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{t("unlock")}</button>
    </form>
  );
}
