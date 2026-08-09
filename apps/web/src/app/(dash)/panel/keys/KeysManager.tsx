"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check, Key, ShieldAlert, Plus, X } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import Input from "@/shared/ui/Input";
import Select from "@/shared/ui/Select";
import Badge from "@/shared/ui/Badge";
import { copyToClipboard } from "@/shared/lib/clipboard";

export interface KeyModelBindingRecord {
  id: string;
  keyId: string;
  /** 收敛后绑定只存 modelId(原 scope+globalModelId+userModelId 已废弃)。 */
  modelId: string;
  createdAt: Date | string | null;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  kind: "master" | "sub";
  enabled: boolean;
  bindings: KeyModelBindingRecord[];
}

export interface ModelRecord {
  id: string;
  name: string;
  displayName?: string;
}

export interface BindableModels {
  globals: ModelRecord[];
  byos: ModelRecord[];
}

function displayKeyPreview(value: string): string {
  return value.endsWith("…") ? `${value.slice(0, -1)}****` : value;
}

interface KeysManagerProps {
  keys: ApiKeyRecord[];
  bindable: BindableModels;
  ensureMasterAction: () => Promise<{ key: string | null; error: string | null }>;
  newSubKeyAction: (name: string) => Promise<string>;
  disableKeyAction: (keyId: string) => Promise<void>;
  bindModelAction: (keyId: string, modelId: string) => Promise<void>;
  unbindBindingAction: (bindingId: string) => Promise<void>;
}

export default function KeysManager({
  keys,
  bindable,
  ensureMasterAction,
  newSubKeyAction,
  disableKeyAction,
  bindModelAction,
  unbindBindingAction,
}: KeysManagerProps) {
  const t = useTranslations("panel.keys");
  const master = keys.find((k) => k.kind === "master" && k.enabled);
  const subKeys = keys.filter((k) => k.kind === "sub" && k.enabled);

  const [selectedSubKeyId, setSelectedSubKeyId] = useState<string | null>(
    subKeys[0]?.id ?? null
  );
  const [newRawKey, setNewRawKey] = useState<{ name: string; key: string } | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [subKeyNameInput, setSubKeyNameInput] = useState("");
  const [selectedModelVal, setSelectedModelVal] = useState("");

  const selectedSubKey = subKeys.find((sk) => sk.id === selectedSubKeyId) ?? null;

  const handleCopyRaw = async () => {
    if (!newRawKey) return;
    if (!(await copyToClipboard(newRawKey.key))) return;
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  const handleCreateMaster = () => {
    startTransition(async () => {
      const { key } = await ensureMasterAction();
      if (key) setNewRawKey({ name: t("masterKey"), key });
    });
  };

  const handleCreateSubKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subKeyNameInput.trim()) return;
    const name = subKeyNameInput.trim();
    setSubKeyNameInput("");

    startTransition(async () => {
      try {
        const rawKey = await newSubKeyAction(name);
        setNewRawKey({ name, key: rawKey });
      } catch (err) {
        console.error(err);
      }
    });
  };

  const handleDisableKey = (id: string) => {
    startTransition(async () => {
      await disableKeyAction(id);
      setNewRawKey(null);
      if (selectedSubKeyId === id) {
        setSelectedSubKeyId(null);
      }
    });
  };

  const handleBindModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubKeyId || !selectedModelVal) return;
    const keyId = selectedSubKeyId;
    const modelId = selectedModelVal;

    setSelectedModelVal("");
    startTransition(async () => {
      await bindModelAction(keyId, modelId);
    });
  };

  const handleUnbind = (bindingId: string) => {
    startTransition(async () => {
      await unbindBindingAction(bindingId);
    });
  };

  const getModelName = (id: string | null) => {
    if (!id) return "-";
    return (
      bindable.globals.find((m) => m.id === id)?.name ||
      bindable.byos.find((m) => m.id === id)?.name ||
      id
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-10 gap-8 items-start">
      {/* Left Column (4 lg cols) */}
      <div className="lg:col-span-4 space-y-6">
        {/* New Raw Key Warning box (Amber) */}
        {newRawKey && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-start gap-2.5 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-ui-body font-semibold">{t("saveSubkeyPrompt")}</h3>
                <p className="text-ui-caption text-amber-600/85 dark:text-amber-400/80 mt-0.5">
                  {t("subkeyWarning", { name: newRawKey.name })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-white dark:bg-[#0f121a] border border-amber-500/20 rounded px-3 py-2">
              <code className="text-ui-caption font-mono select-all break-all flex-1 text-neutral-800 dark:text-neutral-200">
                {newRawKey.key}
              </code>
              <button
                onClick={handleCopyRaw}
                className="p-1 rounded text-amber-600 hover:bg-amber-500/10 transition-colors"
                title={t("copyKey")}
              >
                {copiedRaw ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <Button
              variant="danger"
              size="sm"
              onClick={() => setNewRawKey(null)}
              className="w-full bg-amber-600 hover:bg-amber-700 border-none text-white"
            >
              {t("recordedClose")}
            </Button>
          </div>
        )}

        {/* Master Key Section */}
        <div className="space-y-3">
          <h2 className="text-ui-body font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{t("masterKey")}</h2>
          {master ? (
            <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian p-4 flex items-center justify-between transition-colors duration-150">
              <div className="space-y-1.5 max-w-[75%]">
                <div className="flex items-center gap-1.5 font-mono text-ui-body font-semibold text-neutral-800 dark:text-neutral-200">
                  <Key className="w-4 h-4 text-sora-blue shrink-0" />
                  <span>{displayKeyPreview(master.keyPrefix)}</span>
                </div>
                <div className="text-ui-caption text-neutral-400 leading-normal">
                  {t("masterKeyDesc")}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisableKey(master.id)}
                className="text-red-500 hover:text-red-650 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                {t("revoke")}
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              loading={isPending}
              onClick={handleCreateMaster}
              className="w-full py-2.5 text-ui-body"
            >
              {t("generateMaster")}
            </Button>
          )}
        </div>

        {/* Sub Keys Section */}
        <div className="space-y-3">
          <h2 className="text-ui-body font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{t("subKeys")}</h2>

          {/* Create Subkey Inline Form */}
          <form onSubmit={handleCreateSubKey} className="flex gap-2">
            <Input
              type="text"
              required
              value={subKeyNameInput}
              onChange={(e) => setSubKeyNameInput(e.target.value)}
              placeholder={t("subkeyNamePlaceholder")}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="contrast"
              loading={isPending}
              className="px-4"
            >
              {t("create")}
            </Button>
          </form>

          {/* Subkeys list */}
          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
            {subKeys.length === 0 ? (
              <p className="text-ui-caption text-neutral-400 py-6 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded-lg">
                {t("emptySubkeys")}
              </p>
            ) : (
              subKeys.map((sk) => {
                const isActive = sk.id === selectedSubKeyId;
                return (
                  <div
                    key={sk.id}
                    onClick={() => setSelectedSubKeyId(sk.id)}
                    className={clsx(
                      "cursor-pointer rounded-lg border p-3.5 flex items-center justify-between transition-[background-color,border-color,box-shadow] duration-150 group",
                      isActive
                        ? "bg-sora-blue/[0.03] border-sora-blue/40 text-neutral-900 dark:text-white"
                        : "bg-nebula-white dark:bg-[#0d0f14] border-morning-mist dark:border-deep-space text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-700"
                    )}
                  >
                    <div className="space-y-1">
                      <div className="font-semibold text-ui-body">{sk.name}</div>
                      <div className="flex items-center gap-1 font-mono text-ui-caption text-neutral-400 dark:text-neutral-500">
                        <span>{displayKeyPreview(sk.keyPrefix)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDisableKey(sk.id);
                      }}
                      className="text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                    >
                      {t("disable")}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right Column (6 lg cols) - Detailed Panel */}
      <div className="lg:col-span-6">
        {!selectedSubKey ? (
          <div className="rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-800 p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
            <Key className="w-10 h-10 text-neutral-300 dark:text-neutral-700 mb-3" />
            <h3 className="text-ui-body font-semibold text-neutral-500 dark:text-neutral-400">{t("noSubkeySelected")}</h3>
            <p className="text-ui-caption text-neutral-400 mt-1 max-w-[240px]">
              {t("noSubkeySelectedDesc")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-6 space-y-6 transition-colors duration-150 animate-in fade-in duration-200">
            {/* Panel Header */}
            <div className="border-b border-neutral-100 dark:border-neutral-800 pb-4">
              <div className="text-ui-caption font-medium text-neutral-400 uppercase tracking-wider mb-1">{t("bindingManagement")}</div>
              <h3 className="text-ui-title font-bold text-neutral-800 dark:text-white flex items-center gap-2">
                <span>{selectedSubKey.name}</span>
                <span className="font-mono text-ui-caption text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-[#0f121a] px-2 py-0.5 rounded border border-neutral-200/50 dark:border-neutral-800/50">
                  {displayKeyPreview(selectedSubKey.keyPrefix)}
                </span>
              </h3>
            </div>

            {/* Bindings List */}
            <div className="space-y-3">
              <div className="text-ui-caption font-semibold text-neutral-400 uppercase tracking-wider">{t("boundModels", { count: selectedSubKey.bindings.length })}</div>

              <div className="flex flex-wrap gap-2 min-h-[50px] p-4 rounded-lg bg-neutral-50 dark:bg-[#0f121a]/50 border border-neutral-100 dark:border-neutral-900">
                {selectedSubKey.bindings.length === 0 ? (
                  <span className="text-ui-caption text-neutral-400">{t("noBindings")}</span>
                ) : (
                  selectedSubKey.bindings.map((b) => {
                    const inGlobals = bindable.globals.some((m) => m.id === b.modelId);
                    const modelName = getModelName(b.modelId);
                    const scope = inGlobals ? "global" : "byo";

                    return (
                      <Badge
                        key={b.id}
                        variant={inGlobals ? "primary" : "warning"}
                        className="rounded-full px-2.5 py-1 text-ui-caption hover:border-red-500/30 hover:bg-red-500/[0.04] cursor-pointer"
                      >
                        <span className="opacity-70 text-ui-caption font-mono tracking-wider font-semibold uppercase mr-1">{scope}</span>
                        <span className="font-medium">{modelName}</span>
                        <button
                          onClick={() => handleUnbind(b.id)}
                          className="text-neutral-400 hover:text-red-500 p-0.5 rounded-full transition-colors ml-1"
                          title={t("unbind")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </Badge>
                    );
                  })
                )}
              </div>
            </div>

            {/* Bind New Model Form */}
            <form onSubmit={handleBindModel} className="space-y-3 pt-2">
              <div className="text-ui-caption font-semibold text-neutral-400 uppercase tracking-wider">{t("bindNewModel")}</div>

              <div className="flex gap-2">
                <Select
                  value={selectedModelVal}
                  onChange={(e) => setSelectedModelVal(e.target.value)}
                  className="flex-1"
                >
                  <option value="">{t("selectModelPlaceholder")}</option>

                  {bindable.globals.length > 0 && (
                    <optgroup label={t("globalModels")} className="font-semibold text-ui-caption text-neutral-400">
                      {bindable.globals.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {bindable.byos.length > 0 && (
                    <optgroup label={t("byoModels")} className="font-semibold text-ui-caption text-neutral-400">
                      {bindable.byos.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>

                <Button
                  type="submit"
                  disabled={!selectedModelVal}
                  loading={isPending}
                  variant="contrast"
                  className="font-semibold flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t("bind")}</span>
                </Button>
              </div>
              <p className="text-ui-caption text-neutral-400">
                {t("bindHint")}
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
