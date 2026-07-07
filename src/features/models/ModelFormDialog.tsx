"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ModelCapabilities } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import CapabilitiesEditor from "@/features/models/CapabilitiesEditor";

export interface GlobalModelInitial {
  name?: string;
  displayName?: string;
  vendor?: string;
  accessScope?: "public" | "internal";
  systemPrompt?: string;
  description?: string;
  capabilities?: ModelCapabilities;
}

export interface ByoModelInitial {
  name?: string;
  displayName?: string;
  vendor?: string;
  systemPrompt?: string;
  description?: string;
  capabilities?: ModelCapabilities;
}

interface ModelFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  variant: "global" | "byo";
  initial?: GlobalModelInitial | ByoModelInitial;
}

const labelCls = "block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1";
const inputCls =
  "mt-1 w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3.5 py-2 text-sm bg-white dark:bg-[#0f121a] focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-150 text-neutral-800 dark:text-neutral-200";

export default function ModelFormDialog({
  open,
  onClose,
  mode,
  action,
  variant,
  initial,
}: ModelFormDialogProps) {
  const t = useTranslations("models");
  const isEdit = mode === "edit";
  const isAdmin = variant === "global";

  const gi = isAdmin ? (initial as GlobalModelInitial | undefined) : undefined;
  const bi = !isAdmin ? (initial as ByoModelInitial | undefined) : undefined;
  // byo 与 global 共享除 accessScope 外的全部字段,统一从 ini 取值。
  const ini = gi ?? bi;

  const [formKey, setFormKey] = useState(0);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
  };

  const title =
    isAdmin
      ? isEdit ? t("editGlobalModel") : t("addGlobalModel")
      : isEdit ? t("editByoModel") : t("addByoModel");

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <form
        key={formKey}
        action={action}
        onSubmit={() => setTimeout(handleClose, 0)}
        className="space-y-5"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>
              {t("externalModelNameLabel")} <span className="text-[10px] lowercase font-normal text-neutral-400">{t("externalModelNameHint")}</span>
            </span>
            <input
              name="name"
              required
              defaultValue={ini?.name ?? ""}
              className={inputCls}
              placeholder="gpt-4o"
            />
          </label>

          <label className="block">
            <span className={labelCls}>
              {t("displayNameLabel")} <span className="text-[10px] font-normal text-neutral-400">{t("displayNameHint")}</span>
            </span>
            <input
              name="displayName"
              required={isAdmin}
              defaultValue={ini?.displayName ?? ""}
              className={inputCls}
              placeholder="GPT-4o"
            />
          </label>

          <label className="block">
            <span className={labelCls}>
              {t("colVendor")} <span className="text-[10px] font-normal text-neutral-400">{t("vendorHint")}</span>
            </span>
            <input
              name="vendor"
              defaultValue={ini?.vendor ?? ""}
              className={inputCls}
              placeholder="openai"
            />
          </label>

          {isAdmin && (
            <label className="block">
              <span className={labelCls}>{t("accessScopeLabel")}</span>
              <select
                name="accessScope"
                defaultValue={gi?.accessScope ?? "public"}
                className={inputCls}
              >
                <option value="public">{t("scopePublicOption")}</option>
                <option value="internal">{t("scopeInternalOption")}</option>
              </select>
            </label>
          )}
        </div>

        <label className="block">
          <span className={labelCls}>
            {t("systemPromptLabel")} <span className="text-[10px] font-normal text-neutral-400">{t("optionalHint")}</span>
          </span>
          <textarea
            name="systemPrompt"
            rows={3}
            defaultValue={ini?.systemPrompt ?? ""}
            className="mt-1 w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3.5 py-2 text-sm bg-white dark:bg-[#0f121a] focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-150 resize-none text-neutral-800 dark:text-neutral-200"
            placeholder={t("systemPromptPlaceholder")}
          />
        </label>
        <label className="block">
          <span className={labelCls}>
            {t("descriptionLabel")} <span className="text-[10px] font-normal text-neutral-400">{t("optionalHint")}</span>
          </span>
          <input
            name="description"
            defaultValue={ini?.description ?? ""}
            className={inputCls}
            placeholder={t("descriptionPlaceholder")}
          />
        </label>

        <div className="block pt-1">
          <span className={labelCls}>{t("capabilitiesLabel")}</span>
          <CapabilitiesEditor initial={ini?.capabilities} />
        </div>

        <div className="flex justify-end gap-2.5 pt-3 border-t border-neutral-100 dark:border-neutral-800/80">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-100 px-4 py-2 text-xs font-semibold text-white transition-colors shadow-none"
          >
            {isEdit ? t("save") : t("create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
