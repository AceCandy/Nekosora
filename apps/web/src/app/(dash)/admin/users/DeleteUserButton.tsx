"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { deleteUser } from "../actions";

interface DeleteUserButtonProps {
  userId: string;
  displayName: string;
}

export default function DeleteUserButton({ userId, displayName }: DeleteUserButtonProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target inline-flex items-center justify-center rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        aria-label={t("deleteButton", { name: displayName })}
        title={t("deleteButton", { name: displayName })}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => deleteUser(userId)}
        title={t("deleteConfirmTitle")}
        message={t("deleteConfirmMessage", { name: displayName })}
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        errorMessage={t("deleteFailed")}
      />
    </>
  );
}
