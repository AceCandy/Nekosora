"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/Button";
import { useDraftAction } from "./useDraftAction";

interface BackgroundModelOption {
  id: string;
  name: string;
  displayName: string | null;
}

interface BackgroundModelConfigFormProps {
  id: string;
  title: string;
  modelLabel: string;
  hint: string;
  autoLabel: string;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  saveFailedLabel: string;
  models: BackgroundModelOption[];
  initialModelId: string;
  action: (formData: FormData) => Promise<void>;
}

/** 后台任务模型选择表单；调用方用已保存值作为 key，在 Action reset 后重新收敛。 */
export default function BackgroundModelConfigForm({
  id,
  title,
  modelLabel,
  hint,
  autoLabel,
  saveLabel,
  savingLabel,
  savedLabel,
  saveFailedLabel,
  models,
  initialModelId,
  action,
}: BackgroundModelConfigFormProps) {
  const [modelId, setModelId] = useState(initialModelId);
  const { onSubmit, pending, status } = useDraftAction(action);

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)_auto] md:items-center"
    >
      <div>
        <h3 className="text-ui-body font-bold text-neutral-800 ">{title}</h3>
        <p className="mt-1 text-ui-caption text-neutral-400">{hint}</p>
        <div className="mt-1 min-h-4 text-ui-caption" aria-live="polite">
          {pending && <p className="text-neutral-600">{savingLabel}</p>}
          {!pending && status === "success" && <p role="status" className="text-success">{savedLabel}</p>}
          {!pending && status === "error" && <p role="alert" className="text-danger">{saveFailedLabel}</p>}
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={id} className="text-ui-caption font-medium text-neutral-500">
          {modelLabel}
        </label>
        <select
          id={id}
          name="model_id"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          disabled={pending}
          className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-ui-body "
        >
          <option value="">{autoLabel}</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName || model.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="px-4 py-2 font-semibold md:self-end"
      >
        {pending ? savingLabel : saveLabel}
      </Button>
    </form>
  );
}
