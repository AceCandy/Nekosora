"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import Modal from "@/shared/ui/Modal";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";
import UnsavedChangesDialog, { useUnsavedChanges } from "@/shared/ui/UnsavedChangesDialog";
import { resetUserPassword, type ResetUserPasswordResult } from "../actions";

interface ResetPasswordButtonProps {
  userId: string;
  displayName: string;
}

interface ResetPasswordDialogProps extends ResetPasswordButtonProps {
  onClose: () => void;
}

export function ResetPasswordDialog({ userId, displayName, onClose }: ResetPasswordDialogProps) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const hintId = useId();
  const feedbackId = useId();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [result, setResult] = useState<ResetUserPasswordResult | null>(null);
  const [pending, startTransition] = useTransition();
  const { contentRef, requestClose, dialogProps } = useUnsavedChanges<HTMLFormElement>(onClose);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const invalidPassword = result?.error === "invalidPassword";
  const passwordMismatch = result?.error === "passwordMismatch";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 8 || newPassword.length > 128) {
      setResult({ status: "error", error: "invalidPassword" });
      newPasswordRef.current?.focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      setResult({ status: "error", error: "passwordMismatch" });
      confirmPasswordRef.current?.focus();
      return;
    }

    const formData = new FormData();
    formData.set("newPassword", newPassword);
    formData.set("confirmPassword", confirmPassword);
    startTransition(async () => {
      let next: ResetUserPasswordResult;
      try {
        next = await resetUserPassword(userId, formData);
      } catch {
        next = { status: "error", error: "resetFailed" };
      }
      setResult(next);
      if (next.status === "error") {
        if (next.error === "invalidPassword") newPasswordRef.current?.focus();
        if (next.error === "passwordMismatch") confirmPasswordRef.current?.focus();
      }
      if (next.status === "success") {
        setNewPassword("");
        setConfirmPassword("");
      }
    });
  }

  return (
    <>
      <Modal
        open
        onClose={pending ? () => {} : requestClose}
        title={t("resetTitle")}
        dialogClassName="modal-pop m-auto max-h-[90vh] w-[min(440px,92vw)] overflow-y-auto rounded-lg border border-morning-mist bg-white p-0 text-left text-space-ink shadow-xl backdrop:bg-black/40"
      >
        {result?.status === "success" ? (
          <div className="space-y-4">
            <p role="status" aria-live="polite" className="text-ui-body text-success">
              {t("resetSuccess", { name: displayName })}
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="primary" onClick={onClose} autoFocus>{tc("close")}</Button>
            </div>
          </div>
        ) : (
          <form ref={contentRef} onSubmit={handleSubmit} noValidate className="space-y-4">
            <p className="text-ui-body text-ink-secondary">
              {t("resetDescription", { name: displayName })}
            </p>
            <div className="space-y-1.5">
              <label htmlFor={newPasswordId} className="text-ui-body font-medium text-space-ink">
                {t("newPassword")}
              </label>
              <Input
                ref={newPasswordRef}
                id={newPasswordId}
                name="newPassword"
                type="password"
                value={newPassword}
                onChange={(event) => { setNewPassword(event.target.value); setResult(null); }}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby={`${hintId}${invalidPassword ? ` ${feedbackId}` : ""}`}
                aria-errormessage={invalidPassword ? feedbackId : undefined}
                aria-invalid={invalidPassword || undefined}
                disabled={pending}
                data-autofocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={confirmPasswordId} className="text-ui-body font-medium text-space-ink">
                {t("confirmPassword")}
              </label>
              <Input
                ref={confirmPasswordRef}
                id={confirmPasswordId}
                name="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => { setConfirmPassword(event.target.value); setResult(null); }}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby={passwordMismatch ? feedbackId : undefined}
                aria-errormessage={passwordMismatch ? feedbackId : undefined}
                aria-invalid={passwordMismatch || undefined}
                disabled={pending}
                required
              />
            </div>
            <p id={hintId} className="text-ui-caption text-ink-tertiary">{t("passwordHint")}</p>
            {result?.error && (
              <p id={feedbackId} role="alert" className="text-ui-body text-danger">
                {t(result.error)}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-morning-mist pt-4">
              <Button type="button" onClick={requestClose} disabled={pending}>{tc("cancel")}</Button>
              <Button type="submit" variant="primary" loading={pending}>{t("resetSubmit")}</Button>
            </div>
          </form>
        )}
      </Modal>
      <UnsavedChangesDialog {...dialogProps} />
    </>
  );
}

export default function ResetPasswordButton({ userId, displayName }: ResetPasswordButtonProps) {
  const t = useTranslations("admin.users");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleClose() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target inline-flex items-center justify-center rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-sora-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        aria-label={t("resetButton", { name: displayName })}
        title={t("resetButton", { name: displayName })}
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <ResetPasswordDialog
          userId={userId}
          displayName={displayName}
          onClose={handleClose}
        />
      )}
    </>
  );
}
