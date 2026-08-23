"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import Popover from "@/shared/ui/Popover";
import { Button } from "@/shared/ui/Button";
import type { ModelCatalogOption } from "@/features/models/ModelsManager";
import CatalogDetailCard from "@/features/models/CatalogDetailCard";
import { rankCatalogOptions } from "@/features/models/model-catalog-options";
import Combobox from "@/shared/ui/Combobox";
import UnsavedChangesDialog, { useUnsavedChanges } from "@/shared/ui/UnsavedChangesDialog";
import { Eye } from "lucide-react";

export interface ModelInitial {
  name?: string;
  displayName?: string;
  catalogId?: string;
  /** 可见性:public=发布到全局(仅 admin 可设);private=仅自己可见。 */
  visibility?: "public" | "private";
  systemPrompt?: string;
  description?: string;
  providerId?: string;
  upstreamModelName?: string;
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

const labelCls = "block text-ui-caption font-semibold text-neutral-500  mb-1";
const inputCls =
  "mt-1 w-full rounded-md border border-morning-mist  px-3.5 py-2 text-ui-body bg-white  focus:outline-none focus:border-sora-blue  focus-visible:ring-2 focus-visible:ring-sora-blue/20 transition-colors duration-150 text-space-ink ";

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
  const [externalModelName, setExternalModelName] = useState(ini?.name ?? "");
  // catalog 选择需受控:预览按钮据此定位当前模板详情。提交仍读 formData。
  const [catalogId, setCatalogId] = useState(ini?.catalogId ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  // 原生 form action 抛错会被框架吞掉、前端无反馈;此处捕获后保留弹窗并在模板位置提示。
  const [formError, setFormError] = useState<"catalog" | "duplicate" | null>(null);
  const [pending, startTransition] = useTransition();
  const previewCatalog = catalog.find((c) => c.id === catalogId);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
    setExternalModelName(ini?.name ?? "");
    setFormError(null);
  };
  const { contentRef, requestClose, dialogProps } = useUnsavedChanges<HTMLFormElement>(handleClose);

  const title = isEdit ? t("editModel") : t("addModel");

  return (
    <>
    <Modal open={open} onClose={requestClose} title={title}>
      <form
        ref={contentRef}
        key={formKey}
        onSubmit={(e) => {
          e.preventDefault();
          // 同步读取 formData:异步回调里 currentTarget 已被清空。
          const fd = new FormData(e.currentTarget);
          setFormError(null);
          startTransition(async () => {
            try {
              await action(fd);
              handleClose();
            } catch (error) {
              // server action 抛错(如模板未匹配):保留弹窗,在模板选择处提示。
              setFormError(error instanceof Error && error.message.startsWith("MODEL_ALREADY_EXISTS") ? "duplicate" : "catalog");
            }
          });
        }}
        className="space-y-5"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>
              {t("externalModelNameLabel")} <span className="text-ui-caption lowercase font-normal text-neutral-400">{t("externalModelNameHint")}</span>
            </span>
            <input
              name="name"
              required
              value={externalModelName}
              onChange={(event) => setExternalModelName(event.target.value)}
              className={inputCls}
              placeholder="gpt-4o"
            />
            {ini?.providerId && ini.upstreamModelName && (
              <>
                <input type="hidden" name="providerId" value={ini.providerId} />
                <input type="hidden" name="upstreamModelName" value={ini.upstreamModelName} />
              </>
            )}
          </label>

          <label className="block">
            <span className={labelCls}>
              {t("displayNameLabel")} <span className="text-ui-caption font-normal text-neutral-400">{t("displayNameHint")}</span>
            </span>
            <input
              name="displayName"
              defaultValue={ini?.displayName ?? ""}
              className={inputCls}
              placeholder="GPT-4o"
            />
          </label>

          <div className="block">
            <span className={labelCls}>{t("catalogLabel")}</span>
            <div className="flex items-start gap-2">
              <input type="hidden" name="catalogId" value={catalogId} />
              <Combobox
                value={catalogId}
                displayLabel={previewCatalog?.name}
                onChange={(id) => setCatalogId(id)}
                loadOptions={async (query) => [
                  ...(query ? [] : [{ id: "", label: t("catalogAutoMatch") }]),
                  ...rankCatalogOptions(catalog, externalModelName, query).map((entry) => ({
                    id: entry.id,
                    label: entry.name,
                    sub: entry.canonicalModelId,
                  })),
                ]}
                placeholder={t("catalogAutoMatch")}
                searchPlaceholder={t("catalogSearchPlaceholder")}
                emptyText={t("catalogNoMatch")}
                widthClass="mt-1 flex-1 min-w-0"
                triggerClassName="px-3.5 py-2 text-ui-body"
                panelClassName="w-72 max-w-[calc(100vw-2rem)]"
                portal={false}
                ariaLabel={t("catalogLabel")}
              />
              <Popover
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                side="bottom"
                align="right"
                panelClassName="p-3"
                portal={false}
                trigger={
                  <button
                    type="button"
                    disabled={!previewCatalog}
                    onClick={() => setPreviewOpen(true)}
                    title={t("catalogPreview")}
                    className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-200  px-2.5 py-2 text-ui-caption font-medium text-neutral-600  hover:bg-neutral-50  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {t("catalogPreview")}
                  </button>
                }
              >
                {previewCatalog && <CatalogDetailCard catalog={previewCatalog} />}
              </Popover>
            </div>
            {formError && (
              <p className="mt-1.5 text-ui-caption leading-normal text-danger ">
                {formError === "duplicate" ? t("modelAlreadyExists") : t("catalogMatchFailedHint")}
              </p>
            )}
          </div>

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
            {t("systemPromptLabel")} <span className="text-ui-caption font-normal text-neutral-400">{t("optionalHint")}</span>
          </span>
          <textarea
            name="systemPrompt"
            rows={3}
            defaultValue={ini?.systemPrompt ?? ""}
            className="mt-1 w-full rounded-md border border-morning-mist  px-3.5 py-2 text-ui-body bg-white  focus:outline-none focus:border-sora-blue  focus-visible:ring-2 focus-visible:ring-sora-blue/20 transition-colors duration-150 resize-none text-space-ink "
            placeholder={t("systemPromptPlaceholder")}
          />
        </label>
        <label className="block">
          <span className={labelCls}>
            {t("descriptionLabel")} <span className="text-ui-caption font-normal text-neutral-400">{t("optionalHint")}</span>
          </span>
          <input
            name="description"
            defaultValue={ini?.description ?? ""}
            className={inputCls}
            placeholder={t("descriptionPlaceholder")}
          />
        </label>

        <div className="flex justify-end gap-2.5 pt-3 border-t border-neutral-100 ">
          <Button
            type="button"
            variant="secondary"
            onClick={requestClose}
            className="px-4 py-2 text-ui-caption font-semibold"
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            variant="contrast"
            loading={pending}
            disabled={pending}
            className="px-4 py-2 text-ui-caption font-semibold"
          >
            {isEdit ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Modal>
    <UnsavedChangesDialog {...dialogProps} />
    </>
  );
}
