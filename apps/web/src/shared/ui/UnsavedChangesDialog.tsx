"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function snapshotControls(root: HTMLElement): string {
  const snapshot = Array.from(root.querySelectorAll<FormControl>("input, select, textarea")).reduce<(string | boolean | string[])[][]>((result, control) => {
    const tag = control.tagName.toLowerCase();
    const type = tag === "input" ? (control as HTMLInputElement).type : tag;
    if (tag === "input" && ["button", "submit", "reset"].includes(type)) return result;
    if (tag === "select" && (control as HTMLSelectElement).multiple) {
      result.push([tag, type, Array.from((control as HTMLSelectElement).selectedOptions, (option) => option.value)]);
    } else if (tag === "input" && (type === "checkbox" || type === "radio")) {
      result.push([tag, type, control.value, (control as HTMLInputElement).checked]);
    } else {
      result.push([tag, type, control.value]);
    }
    return result;
  }, []);
  return JSON.stringify(snapshot);
}

export function useUnsavedChanges<T extends HTMLElement>(onClose: () => void) {
  const rootRef = useRef<T | null>(null);
  const baselineRef = useRef<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const contentRef = useCallback((node: T | null) => {
    rootRef.current = node;
    baselineRef.current = node ? snapshotControls(node) : null;
  }, []);

  const requestClose = useCallback(() => {
    const root = rootRef.current;
    if (root && baselineRef.current !== snapshotControls(root)) {
      setConfirmOpen(true);
      return;
    }
    onClose();
  }, [onClose]);

  const continueEditing = useCallback(() => setConfirmOpen(false), []);
  const discardChanges = useCallback(() => {
    setConfirmOpen(false);
    onClose();
  }, [onClose]);

  return {
    contentRef,
    requestClose,
    dialogProps: {
      open: confirmOpen,
      onClose: continueEditing,
      onConfirm: discardChanges,
    },
  };
}

export default function UnsavedChangesDialog(props: UnsavedChangesDialogProps) {
  const t = useTranslations("common");
  return (
    <ConfirmDialog
      {...props}
      title={t("unsavedChangesTitle")}
      message={t("unsavedChangesMessage")}
      confirmLabel={t("discardChanges")}
      cancelLabel={t("continueEditing")}
    />
  );
}
