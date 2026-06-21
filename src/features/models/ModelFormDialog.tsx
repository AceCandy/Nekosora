"use client";
import { useState } from "react";
import type { ModelCapabilities } from "@/db/types";
import type { FormDataSerializableAction } from "@/components/providers/types";
import Modal from "@/components/ui/Modal";
import CapabilitiesEditor from "@/components/models/CapabilitiesEditor";

export interface GlobalModelInitial {
  name?: string;
  displayName?: string;
  vendor?: string;
  accessScope?: "public" | "internal";
  systemPrompt?: string;
  description?: string;
  capabilities?: ModelCapabilities;
}

export interface ByoModelInitial {
  providerId?: string;
  name?: string;
  upstreamModelName?: string;
  capabilities?: ModelCapabilities;
}

interface ModelFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  variant: "global" | "byo";
  byoProviders?: { id: string; name: string }[];
  initial?: GlobalModelInitial | ByoModelInitial;
}

const labelCls = "block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1";
const inputCls =
  "mt-1 w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3.5 py-2 text-sm bg-white dark:bg-[#0f121a] focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-150 text-neutral-800 dark:text-neutral-200";

export default function ModelFormDialog({
  open,
  onClose,
  mode,
  action,
  variant,
  byoProviders,
  initial,
}: ModelFormDialogProps) {
  const isEdit = mode === "edit";
  const [formKey, setFormKey] = useState(0);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
  };

  const title =
    variant === "global"
      ? isEdit ? "编辑全局模型" : "添加全局模型"
      : isEdit ? "编辑自定义模型" : "添加自定义模型";

  const gi = variant === "global" ? (initial as GlobalModelInitial | undefined) : undefined;
  const bi = variant === "byo" ? (initial as ByoModelInitial | undefined) : undefined;

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <form
        key={formKey}
        action={action}
        onSubmit={() => setTimeout(handleClose, 0)}
        className="space-y-5"
      >
        {variant === "byo" && (
          <label className="block">
            <span className={labelCls}>上游 Provider *</span>
            <select
              name="providerId"
              required
              defaultValue={bi?.providerId ?? ""}
              className={inputCls}
            >
              <option value="">选择 Provider...</option>
              {byoProviders?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className={variant === "global" ? "grid grid-cols-2 gap-4" : "space-y-4"}>
          <label className="block">
            <span className={labelCls}>
              对外模型名称 * <span className="text-[10px] lowercase font-normal text-neutral-400">(调用方可见的 Model ID)</span>
            </span>
            <input
              name="name"
              required
              defaultValue={gi?.name ?? bi?.name ?? ""}
              className={inputCls}
              placeholder="gpt-4o"
            />
          </label>

          {variant === "global" ? (
            <>
              <label className="block">
                <span className={labelCls}>
                  显示名称 * <span className="text-[10px] font-normal text-neutral-400">(UI 界面显示名称)</span>
                </span>
                <input
                  name="displayName"
                  required
                  defaultValue={gi?.displayName ?? ""}
                  className={inputCls}
                  placeholder="GPT-4o"
                />
              </label>

              <label className="block">
                <span className={labelCls}>
                  厂商 <span className="text-[10px] font-normal text-neutral-400">(可选, 如 openai/anthropic)</span>
                </span>
                <input
                  name="vendor"
                  defaultValue={gi?.vendor ?? ""}
                  className={inputCls}
                  placeholder="openai"
                />
              </label>

              <label className="block">
                <span className={labelCls}>访问权限范围</span>
                <select
                  name="accessScope"
                  defaultValue={gi?.accessScope ?? "public"}
                  className={inputCls}
                >
                  <option value="public">公开 (Public - 用户/网关可调用)</option>
                  <option value="internal">内部 (Internal - 仅限系统内部任务)</option>
                </select>
              </label>
            </>
          ) : (
            <label className="block">
              <span className={labelCls}>
                上游真实模型名称 * <span className="text-[10px] font-normal text-neutral-400">(具体发给上游 API 的 Model ID)</span>
              </span>
              <input
                name="upstreamModelName"
                required
                defaultValue={bi?.upstreamModelName ?? ""}
                className={inputCls}
                placeholder="gpt-4o-2024-08-06"
              />
            </label>
          )}
        </div>

        {variant === "global" && (
          <>
            <label className="block">
              <span className={labelCls}>
                默认系统提示词 (System Prompt) <span className="text-[10px] font-normal text-neutral-400">(可选)</span>
              </span>
              <textarea
                name="systemPrompt"
                rows={3}
                defaultValue={gi?.systemPrompt ?? ""}
                className="mt-1 w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3.5 py-2 text-sm bg-white dark:bg-[#0f121a] focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-150 resize-none text-neutral-800 dark:text-neutral-200"
                placeholder="在此为该模型预设系统提示词..."
              />
            </label>
            <label className="block">
              <span className={labelCls}>
                简短描述 (Description) <span className="text-[10px] font-normal text-neutral-400">(可选)</span>
              </span>
              <input
                name="description"
                defaultValue={gi?.description ?? ""}
                className={inputCls}
                placeholder="用一句话介绍该模型..."
              />
            </label>
          </>
        )}

        <div className="block pt-1">
          <span className={labelCls}>模型内置能力参数</span>
          <CapabilitiesEditor initial={gi?.capabilities ?? bi?.capabilities} />
        </div>

        <div className="flex justify-end gap-2.5 pt-3 border-t border-neutral-100 dark:border-neutral-800/80">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-100 px-4 py-2 text-xs font-semibold text-white transition-colors shadow-none"
          >
            {isEdit ? "保存" : "创建"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


