"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Modal from "@/shared/ui/Modal";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";

export interface OutputMode {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  icon: string | null;
  enabled: boolean;
  sortOrder: number;
}

interface OutputModeFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: (formData: FormData) => void | Promise<void>;
  initial?: Partial<OutputMode>;
}

const labelCls = "block text-ui-caption font-semibold text-ink-secondary  mb-1.5";

export default function OutputModeFormDialog({
  open,
  onClose,
  mode,
  action,
  initial,
}: OutputModeFormDialogProps) {
  const t = useTranslations("admin.outputModes");
  const isEdit = mode === "edit";
  const [formKey, setFormKey] = useState(0);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? t("editTitle") : t("createTitle")}
    >
      <form
        key={formKey}
        action={action}
        onSubmit={() => {
          setTimeout(handleClose, 0);
        }}
        className="space-y-5"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>{t("fieldName")}</span>
            <Input
              name="name"
              required
              defaultValue={initial?.name ?? ""}
              placeholder={t("namePlaceholder")}
            />
          </label>
          <label className="block">
            <span className={labelCls}>{t("fieldIcon")}</span>
            <Input
              name="icon"
              defaultValue={initial?.icon ?? ""}
              placeholder={t("iconPlaceholder")}
            />
          </label>
          <label className="block col-span-2">
            <span className={labelCls}>{t("fieldDesc")}</span>
            <Input
              name="description"
              defaultValue={initial?.description ?? ""}
              placeholder={t("descPlaceholder")}
            />
          </label>
          {isEdit && (
            <label className="flex items-center gap-2 text-ui-body text-neutral-600  pt-6 cursor-pointer select-none">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={initial?.enabled ?? true}
                className="rounded border-morning-mist "
              />
              <span>{t("fieldEnabled")}</span>
            </label>
          )}
          <label className="block col-span-2">
            <span className={labelCls}>{t("fieldPrompt")}</span>
            <textarea
              name="system_prompt"
              required
              rows={6}
              defaultValue={initial?.systemPrompt ?? ""}
              placeholder={t("promptPlaceholder")}
              className="w-full rounded-md border border-morning-mist  bg-white  px-3 py-2 text-ui-body text-space-ink  focus:outline-none focus:border-sora-blue  focus-visible:ring-2 focus-visible:ring-sora-blue transition-[background-color,color,border-color,box-shadow] duration-150 font-mono resize-y"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-morning-mist ">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            variant="contrast"
            size="sm"
          >
            {isEdit ? t("save") : t("createBtn")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
