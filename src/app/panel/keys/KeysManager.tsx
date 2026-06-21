"use client";
import { useState, useTransition } from "react";
import { Copy, Check, Key, ShieldAlert, Plus, X } from "lucide-react";
import { clsx } from "clsx";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";

export interface KeyModelBindingRecord {
  id: string;
  keyId: string;
  scope: "global" | "byo";
  globalModelId: string | null;
  userModelId: string | null;
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

interface KeysManagerProps {
  keys: ApiKeyRecord[];
  bindable: BindableModels;
  ensureMasterAction: () => Promise<{ key: string | null; error: string | null }>;
  newSubKeyAction: (name: string) => Promise<string>;
  disableKeyAction: (keyId: string) => Promise<void>;
  bindModelAction: (keyId: string, scope: "global" | "byo", modelId: string) => Promise<void>;
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
  const master = keys.find((k) => k.kind === "master");
  const subKeys = keys.filter((k) => k.kind === "sub");

  const [selectedSubKeyId, setSelectedSubKeyId] = useState<string | null>(
    subKeys[0]?.id ?? null
  );
  const [newRawKey, setNewRawKey] = useState<{ name: string; key: string } | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [subKeyNameInput, setSubKeyNameInput] = useState("");
  const [selectedModelVal, setSelectedModelVal] = useState("");

  const selectedSubKey = subKeys.find((sk) => sk.id === selectedSubKeyId) ?? null;

  const handleCopyRaw = () => {
    if (!newRawKey) return;
    navigator.clipboard.writeText(newRawKey.key);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
  };

  const handleCopyPrefix = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateMaster = () => {
    startTransition(async () => {
      await ensureMasterAction();
    });
  };

  const handleCreateSubKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subKeyNameInput.trim()) return;
    const name = subKeyNameInput.trim();
    setSubKeyNameInput("");
    
    // We call the action directly
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
      if (selectedSubKeyId === id) {
        setSelectedSubKeyId(null);
      }
    });
  };

  const handleBindModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubKeyId || !selectedModelVal) return;
    const [scope, modelId] = selectedModelVal.split(":");
    if (scope !== "global" && scope !== "byo") return;

    const keyId = selectedSubKeyId;
    const s = scope as "global" | "byo";
    const mId = modelId;

    setSelectedModelVal("");
    startTransition(async () => {
      await bindModelAction(keyId, s, mId);
    });
  };

  const handleUnbind = (bindingId: string) => {
    startTransition(async () => {
      await unbindBindingAction(bindingId);
    });
  };

  const getModelName = (scope: string, id: string | null) => {
    if (!id) return "-";
    if (scope === "global") {
      return bindable.globals.find((m) => m.id === id)?.name || id;
    } else {
      return bindable.byos.find((m) => m.id === id)?.name || id;
    }
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
                <h3 className="text-sm font-semibold">请复制并保存您的子密钥</h3>
                <p className="text-xs text-amber-600/85 dark:text-amber-400/80 mt-0.5">
                  该密钥名称为 <strong className="font-semibold">“{newRawKey.name}”</strong>。出于安全考虑，此明文密钥仅在此处显示一次，刷新或关闭卡片后将无法找回。
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 bg-white dark:bg-[#0f121a] border border-amber-500/20 rounded px-3 py-2">
              <code className="text-xs font-mono select-all break-all flex-1 text-neutral-800 dark:text-neutral-200">
                {newRawKey.key}
              </code>
              <button
                onClick={handleCopyRaw}
                className="p-1 rounded text-amber-600 hover:bg-amber-500/10 transition-colors"
                title="复制密钥"
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
              我已妥善记录，关闭此卡片
            </Button>
          </div>
        )}

        {/* Master Key Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">主密钥</h2>
          {master ? (
            <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian p-4 flex items-center justify-between transition-colors duration-150">
              <div className="space-y-1.5 max-w-[75%]">
                <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  <Key className="w-4 h-4 text-sora-blue shrink-0" />
                  <span>{master.keyPrefix}</span>
                  <button
                    onClick={() => handleCopyPrefix(master.id, master.keyPrefix)}
                    className="text-neutral-400 hover:text-neutral-600 p-0.5 rounded transition-colors"
                    title="复制前缀"
                  >
                    {copiedId === master.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <div className="text-xs text-neutral-400 leading-normal">
                  主密钥可直接调用全部可见模型。仅在创建时显示明文。
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisableKey(master.id)}
                className="text-red-500 hover:text-red-650 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                禁用
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              loading={isPending}
              onClick={handleCreateMaster}
              className="w-full py-2.5 text-sm"
            >
              生成主密钥
            </Button>
          )}
        </div>

        {/* Sub Keys Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">子密钥</h2>
          
          {/* Create Subkey Inline Form */}
          <form onSubmit={handleCreateSubKey} className="flex gap-2">
            <Input
              type="text"
              required
              value={subKeyNameInput}
              onChange={(e) => setSubKeyNameInput(e.target.value)}
              placeholder="子密钥名称(如:生产环境)"
              className="flex-1"
            />
            <Button
              type="submit"
              variant="contrast"
              loading={isPending}
              className="px-4"
            >
              创建
            </Button>
          </form>

          {/* Subkeys list */}
          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
            {subKeys.length === 0 ? (
              <p className="text-xs text-neutral-400 py-6 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded-lg">
                暂无子密钥。创建子密钥后可配置模型绑定。
              </p>
            ) : (
              subKeys.map((sk) => {
                const isActive = sk.id === selectedSubKeyId;
                return (
                  <div
                    key={sk.id}
                    onClick={() => setSelectedSubKeyId(sk.id)}
                    className={clsx(
                      "cursor-pointer rounded-lg border p-3.5 flex items-center justify-between transition-all duration-150 group",
                      isActive
                        ? "bg-sora-blue/[0.03] border-sora-blue/40 text-neutral-900 dark:text-white"
                        : "bg-nebula-white dark:bg-[#0d0f14] border-morning-mist dark:border-deep-space text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-700"
                    )}
                  >
                    <div className="space-y-1">
                      <div className="font-semibold text-sm">{sk.name}</div>
                      <div className="flex items-center gap-1 font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
                        <span>{sk.keyPrefix}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPrefix(sk.id, sk.keyPrefix);
                          }}
                          className="text-neutral-400 hover:text-neutral-600 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="复制前缀"
                        >
                          {copiedId === sk.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        </button>
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
                      禁用
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
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">未选中子密钥</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-[240px]">
              选择左侧的一个子密钥以对其配置具体可用模型绑定关系。
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-6 space-y-6 transition-colors duration-150 animate-in fade-in duration-200">
            {/* Panel Header */}
            <div className="border-b border-neutral-100 dark:border-neutral-800 pb-4">
              <div className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1">子密钥绑定管理</div>
              <h3 className="text-base font-bold text-neutral-800 dark:text-white flex items-center gap-2">
                <span>{selectedSubKey.name}</span>
                <span className="font-mono text-xs text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-[#0f121a] px-2 py-0.5 rounded border border-neutral-200/50 dark:border-neutral-800/50">
                  {selectedSubKey.keyPrefix}
                </span>
              </h3>
            </div>

            {/* Bindings List */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">已绑定模型 ({selectedSubKey.bindings.length})</div>
              
              <div className="flex flex-wrap gap-2 min-h-[50px] p-4 rounded-lg bg-neutral-50 dark:bg-[#0f121a]/50 border border-neutral-100 dark:border-neutral-900">
                {selectedSubKey.bindings.length === 0 ? (
                  <span className="text-xs text-neutral-400">无绑定。此子密钥当前将无法调用网关内的任何模型。</span>
                ) : (
                  selectedSubKey.bindings.map((b) => {
                    const scope = b.scope as "global" | "byo";
                    const modelId = scope === "global" ? b.globalModelId : b.userModelId;
                    const modelName = getModelName(scope, modelId);
                    
                    return (
                      <Badge
                        key={b.id}
                        variant={scope === "global" ? "primary" : "warning"}
                        className="rounded-full px-2.5 py-1 text-xs hover:border-red-500/30 hover:bg-red-500/[0.04] cursor-pointer"
                      >
                        <span className="opacity-70 text-[10px] font-mono tracking-wider font-semibold uppercase mr-1">{scope}</span>
                        <span className="font-medium">{modelName}</span>
                        <button
                          onClick={() => handleUnbind(b.id)}
                          className="text-neutral-400 hover:text-red-500 p-0.5 rounded-full transition-colors ml-1"
                          title="解绑模型"
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
              <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">绑定新模型</div>
              
              <div className="flex gap-2">
                <Select
                  value={selectedModelVal}
                  onChange={(e) => setSelectedModelVal(e.target.value)}
                  className="flex-1"
                >
                  <option value="">+ 选择需要绑定的上游模型...</option>
                  
                  {bindable.globals.length > 0 && (
                    <optgroup label="全局模型 (Global Models)" className="font-semibold text-xs text-neutral-400">
                      {bindable.globals.map((m) => (
                        <option key={m.id} value={`global:${m.id}`}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {bindable.byos.length > 0 && (
                    <optgroup label="我的模型 (BYO Models)" className="font-semibold text-xs text-neutral-400">
                      {bindable.byos.map((m) => (
                        <option key={m.id} value={`byo:${m.id}`}>
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
                  <span>绑定</span>
                </Button>
              </div>
              <p className="text-[11px] text-neutral-400">
                绑定后，持有该子密钥的客户端即可调用所选的上游模型。
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
