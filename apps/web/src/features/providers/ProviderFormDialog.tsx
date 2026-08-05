"use client";
import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderProtocol } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import KeyBundleEditor, { type EditorRow, type KeyBundleEditorHandle, type TestKeyAction } from "@/features/providers/KeyBundleEditor";
import { DEFAULT_HOSTS, resolveModelsUrl } from "@/lib/providers/defaults";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import Popover from "@/shared/ui/Popover";
import { Button } from "@/shared/ui/Button";
import { ListPlus, Loader2, ChevronDown } from "lucide-react";

interface ProviderFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  protocols: { value: string; label: string }[];
  /** 逐 key 测试 action(可选)。传入则 KeyBundleEditor 启用测试按钮。 */
  testAction?: TestKeyAction;
  /** 拉取最新上游模型列表(可选,编辑模式传入)。传入则检测模型字段显示拉取按钮。 */
  refreshUpstreamModels?: () => Promise<{ models: string[]; checkedAt: number }>;
  initial?: {
    name?: string;
    protocol?: string;
    baseUrl?: string;
    keys?: EditorRow[];
    /** 检测模型(手填或从上游模型列表选)。 */
    testModel?: string;
    /** 已拉取的上游模型 id 列表,供检测模型下拉选择。 */
    upstreamModels?: string[];
    /** 上次拉取上游模型列表的时间(毫秒),用于下拉时按需刷新的缓存判定。 */
    upstreamModelsAt?: number | null;
  };
}

const labelCls = "block text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5";
// 下拉按钮的拉取缓存窗口:5 分钟内不重复请求上游 /models。
const UPSTREAM_MODELS_STALE_MS = 5 * 60 * 1000;

export default function ProviderFormDialog({
  open,
  onClose,
  mode,
  action,
  protocols,
  testAction,
  refreshUpstreamModels,
  initial,
}: ProviderFormDialogProps) {
  const t = useTranslations("providers");
  const isEdit = mode === "edit";
  const [formKey, setFormKey] = useState(0);
  // protocol / baseUrl 需受控,以便测试按钮据此请求对应上游,
  // 并在切换协议时自动填充默认 baseUrl。
  const [protocol, setProtocol] = useState(initial?.protocol ?? protocols[0]?.value ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  // 检测模型的可选列表:初始取已落库值,弹窗内点拉取可即时刷新。
  const [upstreamModels, setUpstreamModels] = useState<string[]>(initial?.upstreamModels ?? []);
  // 上次拉取时间:初始取落库值,弹窗内拉取后即时更新,用于下拉时按需刷新的缓存判定。
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(initial?.upstreamModelsAt ?? null);
  const [refreshing, setRefreshing] = useState(false);
  // 检测模型受控:支持手填,也支持从拉取的模型列表里点选(Popover)。
  // 不用 <datalist>:<dialog> top-layer 会遮挡浏览器原生建议下拉,导致看得见列表却选不了。
  const [testModel, setTestModel] = useState(initial?.testModel ?? "");
  const [modelsOpen, setModelsOpen] = useState(false);
  // 拉取模型列表内的搜索词:模糊过滤,关闭浮层时清空避免下次打开残留。
  const [modelSearch, setModelSearch] = useState("");
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
    setUpstreamModels(initial?.upstreamModels ?? []);
    setLastFetchedAt(initial?.upstreamModelsAt ?? null);
    setTestModel(initial?.testModel ?? "");
    setModelSearch("");
    setNoKey(isEdit && !initialHasKeys);
  };

  // 拉取最新上游模型列表(用已保存配置),刷新检测模型的可选列表。
  // 仅在距上次拉取超过缓存窗口(或从未拉取)时才发真实请求,避免频繁点下拉打上游。
  const handleRefreshIfStale = async () => {
    if (!refreshUpstreamModels || refreshing) return;
    const now = Date.now();
    if (lastFetchedAt != null && now - lastFetchedAt <= UPSTREAM_MODELS_STALE_MS) return;
    setRefreshing(true);
    try {
      const result = await refreshUpstreamModels();
      setUpstreamModels(result.models);
      setLastFetchedAt(result.checkedAt);
    } catch {
      // 拉取失败:静默(按钮恢复,列表不更新),用户可重试或手填。
    } finally {
      setRefreshing(false);
    }
  };

  // 关闭拉取模型浮层并清空搜索词,避免下次打开残留上次的过滤。
  const closeModelsPopover = () => {
    setModelsOpen(false);
    setModelSearch("");
  };

  // 拉取模型列表的展示顺序:先按搜索词模糊过滤(不区分大小写),
  // 再把名字含 free 的模型置顶(如 OVH 免费层),组内保持原顺序。
  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    const matched = q
      ? upstreamModels.filter((m) => m.toLowerCase().includes(q))
      : upstreamModels;
    return [...matched].sort((a, b) => {
      const af = a.toLowerCase().includes("free") ? 0 : 1;
      const bf = b.toLowerCase().includes("free") ? 0 : 1;
      return af - bf;
    });
  }, [upstreamModels, modelSearch]);

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
                <span className="text-ui-caption text-neutral-400 dark:text-neutral-500 font-mono truncate">
                  {t("modelsUrlPreview")}: {modelsUrlPreview}
                </span>
              ) : (
                <span />
              )}
              {DEFAULT_HOSTS[protocol as ProviderProtocol] !== undefined && (
                <button
                  type="button"
                  onClick={resetBaseUrlToDefault}
                  className="text-ui-caption font-semibold text-sora-blue hover:text-sora-blue-hover shrink-0 transition-colors"
                >
                  {t("resetDefault")}
                </button>
              )}
            </div>
          </label>
          <label className="block col-span-2">
            <span className={labelCls}>
              {t("testModelLabel")}{" "}
              <span className="text-ui-caption font-normal text-neutral-400">{t("testModelHint")}</span>
            </span>
            <div className="flex items-center gap-2">
              <Input
                name="testModel"
                value={testModel}
                onChange={(e) => setTestModel(e.target.value)}
                placeholder={t("testModelPlaceholder")}
                className="flex-1 min-w-0"
              />
              {(upstreamModels.length > 0 || refreshUpstreamModels) && (
                <Popover
                  open={modelsOpen}
                  onClose={closeModelsPopover}
                  side="bottom"
                  align="right"
                  portal={false}
                  panelClassName="p-0"
                  trigger={
                    <button
                      type="button"
                      onClick={() => {
                        setModelsOpen(true);
                        void handleRefreshIfStale();
                      }}
                      title={t("selectModelTitle")}
                      className="inline-flex shrink-0 items-center justify-center rounded-md border border-morning-mist dark:border-deep-space px-2.5 py-2 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 transition-colors"
                    >
                      {refreshing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  }
                >
                  <div className="w-60">
                    <div className="sticky top-0 z-10 border-b border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink px-1.5 py-1.5">
                      <Input
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={t("modelSearchPlaceholder")}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-52 overflow-auto py-1">
                      {refreshing && upstreamModels.length === 0 ? (
                        <div className="px-3 py-2 text-ui-caption text-neutral-400 dark:text-neutral-500">
                          {t("modelsLoading")}
                        </div>
                      ) : filteredModels.length === 0 ? (
                        <div className="px-3 py-2 text-ui-caption text-neutral-400 dark:text-neutral-500">
                          {upstreamModels.length === 0 ? t("modelsEmpty") : t("modelSearchNoMatch")}
                        </div>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              setTestModel(m);
                              closeModelsPopover();
                            }}
                            className="block w-full px-3 py-1.5 text-left text-ui-caption font-mono text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 truncate"
                          >
                            {m}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </Popover>
              )}
            </div>
          </label>
          <div className="block col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400">{t("fieldApiKey")}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => editorRef.current?.openBatch()}
                  disabled={noKey}
                  className="inline-flex items-center gap-1 text-ui-caption font-semibold text-sora-blue hover:text-sora-blue-hover transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-sora-blue"
                >
                  <ListPlus size={14} />
                  <span>{t("batchAddKey")}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 cursor-pointer select-none">
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
              testModel={testModel}
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
