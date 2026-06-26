"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderProtocol } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import KeyBundleEditor, { type EditorRow, type TestKeyAction } from "@/features/providers/KeyBundleEditor";
import { DEFAULT_HOSTS, resolveModelsUrl } from "@/lib/providers/defaults";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import { Button } from "@/shared/ui/Button";

interface ProviderFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  protocols: { value: string; label: string }[];
  /** 逐 key 测试 action(可选)。传入则 KeyBundleEditor 启用测试按钮。 */
  testAction?: TestKeyAction;
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
  testAction,
  initial,
}: ProviderFormDialogProps) {
  const t = useTranslations("providers");
  const isEdit = mode === "edit";
  const [formKey, setFormKey] = useState(0);
  // protocol / baseUrl 需受控,以便测试按钮据此请求对应上游,
  // 并在切换协议时自动填充默认 baseUrl。
  const [protocol, setProtocol] = useState(initial?.protocol ?? protocols[0]?.value ?? "openai");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
    setProtocol(initial?.protocol ?? protocols[0]?.value ?? "openai");
    setBaseUrl(initial?.baseUrl ?? "");
  };

  // 切换协议:若当前 baseUrl 为空或仍是某协议的默认值,则自动套用新协议的默认值,
  // 避免用户已填的自定义地址被覆盖。编辑场景同理。
  const handleProtocolChange = (next: string) => {
    setProtocol(next);
    const isDefaultOrEmpty =
      !baseUrl || Object.values(DEFAULT_HOSTS).includes(baseUrl);
    const def = DEFAULT_HOSTS[next as ProviderProtocol];
    if (isDefaultOrEmpty && def !== undefined) {
      setBaseUrl(def);
    }
  };

  const resetBaseUrlToDefault = () => {
    const def = DEFAULT_HOSTS[protocol as ProviderProtocol];
    if (def !== undefined) setBaseUrl(def);
  };

  const modelsUrlPreview = baseUrl ? resolveModelsUrl(protocol as ProviderProtocol, baseUrl) : "";

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
              value={protocol}
              onChange={(e) => handleProtocolChange(e.target.value)}
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
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_HOSTS[protocol as ProviderProtocol] || "https://api.example.com/v1"}
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {modelsUrlPreview ? (
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono truncate">
                  {t("modelsUrlPreview")}: {modelsUrlPreview}
                </span>
              ) : (
                <span />
              )}
              {DEFAULT_HOSTS[protocol as ProviderProtocol] !== undefined && (
                <button
                  type="button"
                  onClick={resetBaseUrlToDefault}
                  className="text-[11px] font-semibold text-sora-blue hover:text-sora-blue-hover shrink-0 transition-colors"
                >
                  {t("resetDefault")}
                </button>
              )}
            </div>
          </label>
          <div className="block col-span-2">
            <span className={labelCls}>{t("fieldApiKey")}</span>
            <KeyBundleEditor
              initialRows={initial?.keys}
              requireKeys={!isEdit}
              protocol={protocol}
              baseUrl={baseUrl}
              testAction={testAction}
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
