"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import KeyBundleEditor, { type EditorRow } from "@/features/providers/KeyBundleEditor";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import { Button } from "@/shared/ui/Button";

interface ProviderFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  protocols: { value: string; label: string }[];
  initial?: {
    name?: string;
    protocol?: string;
    baseUrl?: string;
    keys?: EditorRow[];
  };
}

const labelCls = "block text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5";

export default function ProviderFormDialog({
  open,
  onClose,
  mode,
  action,
  protocols,
  initial,
}: ProviderFormDialogProps) {
  const t = useTranslations("providers");
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
      title={isEdit ? t("editTitle") : t("addTitle")}
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
              placeholder={t("fieldNamePlaceholder")}
            />
          </label>
          <label className="block">
            <span className={labelCls}>{t("fieldProtocol")}</span>
            <Select
              name="protocol"
              defaultValue={initial?.protocol ?? protocols[0]?.value ?? "openai"}
              className="w-full"
            >
              {protocols.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block col-span-2">
            <span className={labelCls}>{t("fieldBaseUrl")}</span>
            <Input
              name="baseUrl"
              required
              defaultValue={initial?.baseUrl ?? ""}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <div className="block col-span-2">
            <span className={labelCls}>{t("fieldApiKey")}</span>
            <KeyBundleEditor
              initialRows={initial?.keys}
              requireKeys={!isEdit}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-morning-mist dark:border-deep-space">
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
            {isEdit ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
