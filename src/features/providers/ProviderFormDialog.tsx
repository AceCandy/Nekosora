"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderProtocol } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import KeyBundleEditor, { type EditorRow, type KeyBundleEditorHandle, type TestKeyAction } from "@/features/providers/KeyBundleEditor";
import { DEFAULT_HOSTS, resolveModelsUrl } from "@/lib/providers/defaults";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import { Button } from "@/shared/ui/Button";
import { ListPlus } from "lucide-react";

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
  const [protocol, setProtocol] = useState(initial?.protocol ?? protocols[0]?.value ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  // 无 key provider(如 OVH 免费层):勾选后禁用密钥输入,提交空 key bundle,
  // 转发用空 key,日志以「无key」记录。编辑模式回显时若已无 key 则默认勾选。
  const initialHasKeys = !!(initial?.keys && initial.keys.some((k) => k.key.trim()));
  const [noKey, setNoKey] = useState(isEdit && !initialHasKeys);
  // 保存前交由 KeyBundleEditor 查重(发现重复则阻止本次提交)。
  const editorRef = useRef<KeyBundleEditorHandle>(null);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
    setProtocol(initial?.protocol ?? protocols[0]?.value ?? "openai-compatible");
    setBaseUrl(initial?.baseUrl ?? "");
    setNoKey(isEdit && !initialHasKeys);
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
        onSubmit={(e) => {
          // 先做客户端查重:有重复则阻止提交并高亮到重复行,放行后再走原关闭逻辑。
          if (editorRef.current?.validateDuplicates()) {
            e.preventDefault();
            return;
          }
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
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t("fieldApiKey")}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => editorRef.current?.openBatch()}
                  disabled={noKey}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-sora-blue hover:text-sora-blue-hover transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-sora-blue"
                >
                  <ListPlus size={14} />
                  <span>{t("batchAddKey")}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={noKey}
                    onChange={(e) => setNoKey(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600 text-sora-blue focus:ring-sora-blue/30 cursor-pointer"
                  />
                  {t("noKey")}
                </label>
              </div>
            </div>
            <input type="hidden" name="noKey" value={noKey ? "1" : ""} />
            <KeyBundleEditor
              ref={editorRef}
              initialRows={initial?.keys}
              requireKeys={false}
              noKey={noKey}
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
