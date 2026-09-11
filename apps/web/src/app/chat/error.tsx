"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/shared/ui/Button";

interface ChatErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ChatError({ reset }: ChatErrorProps) {
  const t = useTranslations("chat");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div role="alert" className="max-w-prose">
        <h1 className="text-ui-title font-semibold text-space-ink">{t("loadFailed")}</h1>
        <p className="mt-2 text-ui-body text-ink-secondary">{t("loadFailedHint")}</p>
      </div>
      <Button loading={pending} onClick={() => startTransition(() => {
        router.refresh();
        reset();
      })}>{t("retry")}</Button>
    </div>
  );
}
