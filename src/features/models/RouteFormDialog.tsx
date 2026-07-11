"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";
import UpstreamModelPicker, { type FetchModelsAction } from "@/features/models/UpstreamModelPicker";

export interface RouteInitial {
  providerId?: string;
  upstreamModelName?: string;
  priority?: number;
  weight?: number;
}

interface RouteFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  action: FormDataSerializableAction;
  /** 可选 provider 下拉项。 */
  providers: { id: string; name: string }[];
  /** 拉取上游模型列表的 action(按 providerId)。不传则不显示拉取按钮。 */
  fetchModelsAction?: FetchModelsAction;
  /** 当前模型对外名;新增模式下选好 provider 后据此在上游列表里匹配同名自动填充。 */
  modelName?: string;
  initial?: RouteInitial;
}

const inputCls =
  "mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

/**
 * 路由(模型 → Provider)新增/编辑弹窗。
 * 字段:providerId(必填)、upstreamModelName(必填)、priority、weight。
 * 协议由所选 provider 决定,路由不再单独配置。
 * 提交时塞进隐藏的 modelId(由调用方 action 已 .bind 好 modelId 时可不传)。
 *
 * priority/weight 语义说明:
 *   priority 小的优先(主备故障转移);同 priority 内按 weight 加权随机(负载均衡)。
 */
export default function RouteFormDialog({
  open,
  onClose,
  mode,
  action,
  providers,
  fetchModelsAction,
  modelName,
  initial,
}: RouteFormDialogProps) {
  const t = useTranslations("models");
  const isEdit = mode === "edit";
  const [formKey, setFormKey] = useState(0);
  // provider 选择需受控,以便拉取按钮据此请求对应上游。
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const upstreamInputRef = useRef<HTMLInputElement>(null);
  // upstreamModelName 受控:兼容手填、拉取器 ref 写回(经 input 事件同步)与下面的自动匹配填充。
  const [upstreamModelName, setUpstreamModelName] = useState(initial?.upstreamModelName ?? "");
  // 新增模式下选好 provider 后,自动拉取上游列表并匹配与当前模型同名的条目填入;每个 provider 只触发一次。
  const matchedProviders = useRef<Set<string>>(new Set());
  const [, startMatchTransition] = useTransition();
  useEffect(() => {
    if (isEdit || !providerId || !fetchModelsAction || !modelName) return;
    if (matchedProviders.current.has(providerId)) return;
    matchedProviders.current.add(providerId);
    startMatchTransition(async () => {
      try {
        const list = await fetchModelsAction(providerId);
        const hit = list.find((m) => m.id === modelName);
        if (hit) setUpstreamModelName(hit.id);
      } catch {
        // 拉取失败静默:不覆盖,留给用户手填或点拉取按钮。
      }
    });
  }, [providerId, fetchModelsAction, modelName, isEdit, startMatchTransition]);

  const handleClose = () => {
    onClose();
    setFormKey((k) => k + 1);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? t("editRoute") : t("addRouteTitle")}
    >
      <form
        key={formKey}
        action={action}
        onSubmit={() => setTimeout(handleClose, 0)}
        className="space-y-4"
      >
        <label className="block">
          <span className="text-sm font-medium">{t("upstreamProviderLabel")}</span>
          <select
            name="providerId"
            required
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className={inputCls}
          >
            <option value="">{t("selectProvider")}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">
            {t("upstreamModelNameShortLabel")} <span className="text-xs font-normal text-neutral-400">{t("upstreamModelShortHint")}</span>
          </span>
          <div className="flex items-center gap-2">
            <input
              ref={upstreamInputRef}
              name="upstreamModelName"
              required
              value={upstreamModelName}
              onChange={(e) => setUpstreamModelName(e.target.value)}
              className={inputCls}
              placeholder="gpt-4o-2024-08-06"
            />
            {fetchModelsAction && (
              <UpstreamModelPicker
                fetchAction={fetchModelsAction}
                providerId={providerId}
                inputRef={upstreamInputRef}
              />
            )}
          </div>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium" title={t("priorityTitle")}>
              {t("priorityLabel")}
            </span>
            <input
              name="priority"
              type="number"
              defaultValue={initial?.priority ?? 0}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium" title={t("weightTitle")}>
              {t("weightLabel")}
            </span>
            <input
              name="weight"
              type="number"
              min={0}
              defaultValue={initial?.weight ?? 1}
              className={inputCls}
            />
          </label>
        </div>
        <p className="text-xs text-neutral-400">
          {t("priorityWeightExplanation")}
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-black"
          >
            {isEdit ? t("save") : t("create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
