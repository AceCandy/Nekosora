"use client";

import { useState } from "react";

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
  models,
  initialModelId,
  action,
}: BackgroundModelConfigFormProps) {
  const [modelId, setModelId] = useState(initialModelId);

  return (
    <form
      action={action}
      className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3"
    >
      <h3 className="text-ui-body font-bold text-neutral-800 dark:text-white">{title}</h3>
      <div className="space-y-1">
        <label htmlFor={id} className="text-ui-caption font-medium text-neutral-500">
          {modelLabel}
        </label>
        <select
          id={id}
          name="model_id"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-ui-body dark:border-neutral-800"
        >
          <option value="">{autoLabel}</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName || model.name}
            </option>
          ))}
        </select>
        <p className="text-ui-caption text-neutral-400">{hint}</p>
      </div>
      <button
        type="submit"
        className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-ui-body font-semibold cursor-pointer"
      >
        {saveLabel}
      </button>
    </form>
  );
}
