"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import type { ModelCatalogOption } from "@/features/models/ModelsManager";

export interface ModelInitial {
  name?: string;
  displayName?: string;
  catalogId?: string;
  /** 可见性:public=发布到全局(仅 admin 可设);private=仅自己可见。 */
  visibility?: "public" | "private";
  systemPrompt?: string;
  description?: string;
}

interface ModelFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  /** admin 可见「发布到全局」(visibility) 选择器;普通用户恒 private,不渲染该字段。 */
  isAdmin?: boolean;
  /** 可见性已由列表中的专用发布控件管理时,编辑模式不再渲染该字段。 */
  visibilityManagedInList?: boolean;
  initial?: ModelInitial;
  catalog: ModelCatalogOption[];
}

const labelCls = "block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1";
const inputCls =
  "mt-1 w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3.5 py-2 text-sm bg-white dark:bg-[#0f121a] focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-150 text-neutral-800 dark:text-neutral-200";

export default function ModelFormDialog({
  open,
  onClose,
  mode,
  action,
  isAdmin = false,
  visibilityManagedInList = false,
  initial,
  catalog,
}: ModelFormDialogProps) {
  const t = useTranslations("models");
  const isEdit = mode === "edit";
  const ini = initial;

  const [formKey, setFormKey] = useState(0);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
  };

  const title = isEdit ? t("editModel") : t("addModel");

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
              {t("catalogLabel")}
            </span>
            <select
              name="catalogId"
              defaultValue={ini?.catalogId ?? ""}
              className={inputCls}
            >
              <option value="">{t("catalogAutoMatch")}</option>
              {catalog.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </label>

          {isAdmin && (!isEdit || !visibilityManagedInList) && (
            <label className="block">
              <span className={labelCls}>{t("visibilityLabel")}</span>
              <select
                name="visibility"
                defaultValue={ini?.visibility ?? "private"}
                className={inputCls}
              >
                <option value="private">{t("visibilityPrivateOption")}</option>
                <option value="public">{t("visibilityPublicOption")}</option>
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
