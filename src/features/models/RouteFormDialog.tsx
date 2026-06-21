"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FormDataSerializableAction } from "@/features/providers/types";
import Modal from "@/shared/ui/Modal";

export interface RouteInitial {
  providerId?: string;
  upstreamModelName?: string;
  protocol?: string;
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
  initial?: RouteInitial;
  /** 协议下拉项。 */
  protocols?: { value: string; label: string }[];
}

const DEFAULT_PROTOCOLS = [
  { value: "openai", label: "openai" },
  { value: "anthropic", label: "anthropic" },
  { value: "gemini", label: "gemini" },
];

const inputCls =
  "mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

/**
 * 路由(模型 → Provider)新增/编辑弹窗。
 * 字段:providerId(必填)、upstreamModelName(必填)、protocol、priority、weight。
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
  initial,
  protocols = DEFAULT_PROTOCOLS,
}: RouteFormDialogProps) {
  const t = useTranslations("models");
  const isEdit = mode === "edit";
  const [formKey, setFormKey] = useState(0);

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
            defaultValue={initial?.providerId ?? ""}
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
          <input
            name="upstreamModelName"
            required
            defaultValue={initial?.upstreamModelName ?? ""}
            className={inputCls}
            placeholder="gpt-4o-2024-08-06"
          />
        </label>

        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="text-sm font-medium">{t("colProtocol")}</span>
            <select
              name="protocol"
              defaultValue={initial?.protocol ?? "openai"}
              className={inputCls}
            >
              {protocols.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
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
