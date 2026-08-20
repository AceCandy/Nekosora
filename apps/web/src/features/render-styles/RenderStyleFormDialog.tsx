"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Modal from "@/shared/ui/Modal";
import Input from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";
import { ShieldAlert } from "lucide-react";

export interface RenderStyle {
  id: string;
  name: string;
  description: string | null;
  cssClass: string;
  css: string;
  icon: string | null;
  renderer: "streamdown" | "custom";
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
}

interface RenderStyleFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: (formData: FormData) => void | Promise<void>;
  initial?: Partial<RenderStyle>;
}

const labelCls = "block text-ui-caption font-semibold text-ink-secondary  mb-1.5";

export default function RenderStyleFormDialog({
  open,
  onClose,
  mode,
  action,
  initial,
}: RenderStyleFormDialogProps) {
  const t = useTranslations("admin.renderStyles");
  const isEdit = mode === "edit";
  // 内置预设编辑时 cssClass 锁定不可改(会破坏已发布 CSS 的选择器约定)
  const cssClassReadOnly = isEdit && initial?.builtin;
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
        {isEdit && initial?.renderer === "custom" && (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-md border border-neku-amber/30 bg-neku-amber/[0.04] p-3"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-ui-body leading-5 text-space-ink">
              {t("customRendererWarning")}
            </p>
          </div>
        )}
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
            <span className={labelCls}>{t("fieldCssClass")}</span>
            <Input
              name="css_class"
              required
              readOnly={cssClassReadOnly}
              defaultValue={initial?.cssClass ?? ""}
              placeholder={t("cssClassPlaceholder")}
              className={cssClassReadOnly ? "opacity-60 cursor-not-allowed" : ""}
            />
            <span className="block text-ui-caption text-neutral-400  mt-1 leading-normal">
              {t("cssClassHint")}
            </span>
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
            <span className={labelCls}>{t("fieldCss")}</span>
            <textarea
              name="css"
              required
              rows={8}
              defaultValue={initial?.css ?? ""}
              placeholder={t("cssPlaceholder")}
              className="w-full rounded-md border border-morning-mist  bg-white  px-3 py-2 text-ui-body text-space-ink  focus:outline-none focus:border-sora-blue  focus-visible:ring-2 focus-visible:ring-sora-blue transition-[background-color,color,border-color,box-shadow] duration-150 font-mono resize-y"
            />
            <span className="block text-ui-caption text-neutral-400  mt-1 leading-normal">
              {t("cssHint")}
            </span>
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
