"use client";

import { useState, useTransition, type FormEvent } from "react";

export type DraftActionStatus = "idle" | "success" | "error";

/** 调用设置 Server Action；失败时不重置原生表单，保留管理员输入。 */
export function useDraftAction(action: (formData: FormData) => Promise<void>) {
  const [status, setStatus] = useState<DraftActionStatus>("idle");
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setStatus("idle");
      try {
        await action(formData);
        setStatus("success");
      } catch {
        setStatus("error");
      }
    });
  };

  return { onSubmit, pending, status };
}
