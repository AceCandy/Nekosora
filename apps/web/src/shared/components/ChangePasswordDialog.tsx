"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import Modal from "@/shared/ui/Modal";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";
import UnsavedChangesDialog, { useUnsavedChanges } from "@/shared/ui/UnsavedChangesDialog";

export type PasswordChangeError =
  | "currentPasswordRequired"
  | "invalidCurrentPassword"
  | "invalidPassword"
  | "passwordMismatch"
  | "changeFailed";

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): PasswordChangeError | null {
  if (!currentPassword) return "currentPasswordRequired";
  if (newPassword.length < 8 || newPassword.length > 128) return "invalidPassword";
  if (newPassword !== confirmPassword) return "passwordMismatch";
  return null;
}

export function classifyPasswordChangeError(code?: string): PasswordChangeError {
  if (code === "INVALID_PASSWORD") return "invalidCurrentPassword";
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return "invalidPassword";
  return "changeFailed";
}

export function changeOwnPassword(currentPassword: string, newPassword: string) {
  return authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
}

export default function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const hintId = useId();
  const feedbackId = useId();
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<PasswordChangeError | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [pending, startTransition] = useTransition();
  const { contentRef, requestClose, dialogProps } = useUnsavedChanges<HTMLFormElement>(handleClose);
  const currentPasswordInvalid = error === "currentPasswordRequired" || error === "invalidCurrentPassword";
  const newPasswordInvalid = error === "invalidPassword";
  const confirmPasswordInvalid = error === "passwordMismatch";

  function focusError(nextError: PasswordChangeError) {
    if (nextError === "currentPasswordRequired" || nextError === "invalidCurrentPassword") {
      currentPasswordRef.current?.focus();
    } else if (nextError === "invalidPassword") {
      newPasswordRef.current?.focus();
    } else if (nextError === "passwordMismatch") {
      confirmPasswordRef.current?.focus();
    }
  }

  function clearFields() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function handleClose() {
    if (pending) return;
    clearFields();
    setError(null);
    setSucceeded(false);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const validationError = validatePasswordChange(currentPassword, newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      focusError(validationError);
      return;
    }

    startTransition(async () => {
      try {
        const response = await changeOwnPassword(currentPassword, newPassword);
        if (response.error) {
          const nextError = classifyPasswordChangeError(response.error.code);
          setError(nextError);
          requestAnimationFrame(() => focusError(nextError));
          return;
        }
        clearFields();
        setError(null);
        setSucceeded(true);
      } catch {
        setError("changeFailed");
      }
    });
  }

  return (
    <>
      <Modal
        open={open}
        onClose={pending ? handleClose : requestClose}
        title={t("changePasswordTitle")}
        dialogClassName="modal-pop m-auto max-h-[90vh] w-[min(440px,92vw)] overflow-y-auto rounded-lg border border-morning-mist bg-white p-0 text-left text-space-ink shadow-xl backdrop:bg-black/40"
      >
        {succeeded ? (
          <div className="space-y-4">
            <p role="status" aria-live="polite" className="text-ui-body text-success">
              {t("changePasswordSuccess")}
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="primary" onClick={handleClose} autoFocus>{tc("close")}</Button>
            </div>
          </div>
        ) : (
          <form ref={contentRef} onSubmit={handleSubmit} noValidate className="space-y-4">
            <p className="text-ui-body text-ink-secondary">{t("changePasswordDescription")}</p>
            <div className="space-y-1.5">
              <label htmlFor={currentPasswordId} className="text-ui-body font-medium text-space-ink">
                {t("currentPassword")}
              </label>
              <Input
                ref={currentPasswordRef}
                id={currentPasswordId}
                name="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(event) => { setCurrentPassword(event.target.value); setError(null); }}
                autoComplete="current-password"
                aria-describedby={currentPasswordInvalid ? feedbackId : undefined}
                aria-errormessage={currentPasswordInvalid ? feedbackId : undefined}
                aria-invalid={currentPasswordInvalid || undefined}
                disabled={pending}
                data-autofocus
                required
              />
            </div>
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
                onChange={(event) => { setNewPassword(event.target.value); setError(null); }}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby={`${hintId}${newPasswordInvalid ? ` ${feedbackId}` : ""}`}
                aria-errormessage={newPasswordInvalid ? feedbackId : undefined}
                aria-invalid={newPasswordInvalid || undefined}
                disabled={pending}
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
                onChange={(event) => { setConfirmPassword(event.target.value); setError(null); }}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby={confirmPasswordInvalid ? feedbackId : undefined}
                aria-errormessage={confirmPasswordInvalid ? feedbackId : undefined}
                aria-invalid={confirmPasswordInvalid || undefined}
                disabled={pending}
                required
              />
            </div>
            <p id={hintId} className="text-ui-caption text-ink-tertiary">{t("passwordHint")}</p>
            {error && (
              <p id={feedbackId} role="alert" className="text-ui-body text-danger">
                {t(error)}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-morning-mist pt-4">
              <Button type="button" onClick={requestClose} disabled={pending}>{tc("cancel")}</Button>
              <Button type="submit" variant="primary" loading={pending}>{t("changePasswordSubmit")}</Button>
            </div>
          </form>
        )}
      </Modal>
      <UnsavedChangesDialog {...dialogProps} />
    </>
  );
}
