"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WebSearchProviderConfig, WebSearchProviderType } from "@/lib/web-search/types";
import { Input } from "@/shared/ui/Input";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/Button";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { clsx } from "clsx";

/** 表单输入(不含 id/enabled;新增时 enabled 默认 true)。 */
export type WebSearchProviderInput = Omit<WebSearchProviderConfig, "id" | "enabled">;

interface Props {
  providers: WebSearchProviderConfig[];
  createAction: (input: WebSearchProviderInput & { enabled: boolean }) => Promise<void>;
  updateAction: (id: string, input: WebSearchProviderInput) => Promise<void>;
  toggleAction: (id: string, enabled: boolean) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
}

const TYPES: WebSearchProviderType[] = ["tavily", "bocha", "zhipu", "searxng"];

/**
 * 联网搜索源管理 -- per-user 多 provider 配置。
 * 取首个 enabled 为生效项(与 registry.resolveProvider 语义一致)。
 * 表单字段随 type 切换:tavily/bocha/zhipu 需 apiKey,zhipu 可选 model,searxng 需 baseUrl。
 */
export default function WebSearchManager({
  providers,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
}: Props) {
  const t = useTranslations("panel.webSearch");
  // 首个 enabled 的 provider 即当前生效项。
  const activeIndex = providers.findIndex((p) => p.enabled);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<WebSearchProviderType>("tavily");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebSearchProviderConfig | null>(null);

  function resetForm() {
    setEditingId(null);
    setType("tavily");
    setName("");
    setApiKey("");
    setModel("");
    setBaseUrl("");
  }

  function startEdit(p: WebSearchProviderConfig) {
    setEditingId(p.id);
    setType(p.type);
    setName(p.name);
    setApiKey(p.apiKey ?? "");
    setModel(p.model ?? "");
    setBaseUrl(p.baseUrl ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      // 仅保留当前 type 相关字段,避免切换 type 后残留旧字段(如 searxng 不应存 apiKey)。
      const input: WebSearchProviderInput = {
        type,
        name: name.trim(),
        apiKey: needsApiKey ? apiKey.trim() || undefined : undefined,
        model: needsModel ? model.trim() || undefined : undefined,
        baseUrl: needsBaseUrl ? baseUrl.trim() || undefined : undefined,
      };
      if (editingId) await updateAction(editingId, input);
      else await createAction({ ...input, enabled: true });
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(p: WebSearchProviderConfig) {
    setPendingId(p.id);
    try {
      await toggleAction(p.id, !p.enabled);
    } finally {
      setPendingId(null);
    }
  }

  async function handleDeleteConfirm() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setPendingId(target.id);
    try {
      await deleteAction(target.id);
      if (editingId === target.id) resetForm();
    } finally {
      setPendingId(null);
    }
  }

  const needsApiKey = type !== "searxng";
  const needsModel = type === "zhipu";
  const needsBaseUrl = type === "searxng";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
      {/* 左:已配置的 provider 列表 */}
      <div className="lg:col-span-2 space-y-3">
        {providers.length === 0 && (
          <div className="rounded-lg border border-dashed border-morning-mist dark:border-deep-space p-10 text-center text-ui-caption text-neutral-400 dark:text-neutral-500">
            {t("empty")}
          </div>
        )}

        {providers.map((p, i) => {
          const isActive = p.enabled && i === activeIndex;
          return (
            <div
              key={p.id}
              className="rounded-lg border border-morning-mist dark:border-deep-space bg-white dark:bg-[#0d0f14] p-4 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-ui-caption font-medium border shrink-0",
                      p.type === "searxng"
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                        : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    {t(`type_${p.type}`)}
                  </span>
                  {isActive && (
                    <span className="rounded-full px-2 py-0.5 text-ui-caption font-medium border bg-sora-blue/[0.03] border-sora-blue/20 text-sora-blue shrink-0">
                      {t("activeBadge")}
                    </span>
                  )}
                  <span className="text-ui-body font-medium text-neutral-800 dark:text-neutral-200 truncate">
                    {p.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="xs" variant="ghost" onClick={() => startEdit(p)} disabled={!!pendingId}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setDeleteTarget(p)} disabled={!!pendingId}>
                    <Trash2 className="w-3 h-3 text-red-500" />
                  </Button>
                </div>
              </div>

              <div className="text-ui-caption text-neutral-400 dark:text-neutral-500 font-mono break-all">
                {p.type === "searxng"
                  ? p.baseUrl || `${t("baseUrlLabel")}: -`
                  : p.apiKey
                    ? `${p.apiKey.slice(0, 6)}••••••••`
                    : `${t("apiKeyLabel")}: -`}
                {p.type === "zhipu" && p.model ? ` · ${p.model}` : ""}
              </div>

              <div className="flex justify-end pt-1 border-t border-neutral-100 dark:border-neutral-800/60">
                <Button
                  size="xs"
                  variant={p.enabled ? "secondary" : "ghost"}
                  onClick={() => handleToggle(p)}
                  disabled={!!pendingId}
                  loading={pendingId === p.id}
                >
                  {p.enabled ? t("disableBtn") : t("enableBtn")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 右:添加/编辑表单 */}
      <div className="lg:col-span-1 rounded-lg border border-morning-mist dark:border-deep-space bg-white dark:bg-[#0d0f14] p-5 space-y-4">
        <div className="border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
          <h3 className="text-ui-body font-bold text-neutral-800 dark:text-white flex items-center gap-1.5">
            {editingId ? <Edit2 className="w-4 h-4 text-blue-500" /> : <Plus className="w-4 h-4 text-blue-500" />}
            <span>{editingId ? t("editTitle") : t("addTitle")}</span>
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
              {t("typeLabel")}
            </span>
            <Select value={type} onChange={(e) => setType(e.target.value as WebSearchProviderType)} className="w-full">
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`type_${ty}`)}
                </option>
              ))}
            </Select>
            <span className="block text-ui-caption text-neutral-400 dark:text-neutral-500 mt-1">{t(`hint_${type}`)}</span>
          </label>

          <label className="block">
            <span className="block text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
              {t("nameLabel")}
            </span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
          </label>

          {needsApiKey && (
            <label className="block">
              <span className="block text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                {t("apiKeyLabel")}
              </span>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t("apiKeyPlaceholder")}
                autoComplete="off"
              />
            </label>
          )}

          {needsModel && (
            <label className="block">
              <span className="block text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                {t("modelLabel")}
              </span>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("modelPlaceholder")} />
            </label>
          )}

          {needsBaseUrl && (
            <label className="block">
              <span className="block text-ui-caption font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                {t("baseUrlLabel")}
              </span>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t("baseUrlPlaceholder")}
              />
            </label>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" variant="contrast" size="sm" loading={saving} className="flex-1">
              {editingId ? t("saveBtn") : t("addBtn")}
            </Button>
            {editingId && (
              <Button type="button" variant="secondary" size="sm" onClick={resetForm}>
                {t("cancelBtn")}
              </Button>
            )}
          </div>
        </form>

        <div className="rounded p-3 bg-neutral-50 dark:bg-neutral-900/30 text-ui-caption text-neutral-400 dark:text-neutral-500 leading-normal space-y-1">
          <p className="font-semibold text-neutral-500 dark:text-neutral-400">{t("guideTitle")}</p>
          <p>{t("guide1")}</p>
          <p>{t("guide2")}</p>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t("deleteConfirmTitle")}
        message={t("deleteConfirmMsg", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("deleteBtn")}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
