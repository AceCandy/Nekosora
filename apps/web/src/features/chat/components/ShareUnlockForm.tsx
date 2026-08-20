"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { unlockShare } from "@/features/chat/actions/share";
import { Button } from "@/shared/ui/Button";

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
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600  "><KeyRound className="h-5 w-5" /></div>
      <div><h1 className="text-ui-title font-semibold">{t("passwordRequired")}</h1><p className="mt-1 text-ui-body text-neutral-500 ">{t("passwordRequiredDescription")}</p></div>
      <label className="block space-y-1.5"><span className="text-ui-body font-medium">{t("password")}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus autoComplete="current-password" className="h-11 w-full rounded-lg border border-morning-mist bg-white px-3 text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  " /></label>
      {error && <p role="alert" className="text-ui-caption text-danger ">{error}</p>}
      <Button type="submit" variant="primary" loading={isPending} disabled={!password} className="h-10 w-full">{t("unlock")}</Button>
    </form>
  );
}
