"use client";
import { useRef, useState } from "react";
import UpstreamModelPicker, { type FetchModelsAction } from "@/features/models/UpstreamModelPicker";
import { Button } from "@/shared/ui/Button";
import { useDraftAction } from "./useDraftAction";

/** embedding 模型名启发式:上游 /models 不返回模型类型,只能靠名称识别 embedding 类。 */
const EMBEDDING_NAME_RE = /embed/i;

interface EmbeddingConfigFormProps {
  providers: { id: string; name: string }[];
  initialProviderId: string;
  initialModel: string;
  /** 拉取上游模型列表的 action(带缓存)。 */
  fetchAction: FetchModelsAction;
  /** saveEmbedding server action(读 provider_id / model 两个 form 字段)。 */
  action: (formData: FormData) => Promise<void>;
  labels: {
    embeddingTitle: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingHint: string;
    selectProvider: string;
    save: string;
    saving: string;
    saved: string;
    saveFailed: string;
  };
}

/**
 * Embedding 配置表单(client)-- provider/model 受控。
 * 选好 provider 后用 UpstreamModelPicker 从已拉取列表选 embedding 模型
 * (默认只显示含 embed 的,搜索时放开全量兜底);model input 仍可手填。
 * 提交走 saveEmbedding server action,字段名与原表统一致。
 */
export default function EmbeddingConfigForm({
  providers,
  initialProviderId,
  initialModel,
  fetchAction,
  action,
  labels,
}: EmbeddingConfigFormProps) {
  const [providerId, setProviderId] = useState(initialProviderId);
  const [model, setModel] = useState(initialModel);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const { onSubmit, pending, status } = useDraftAction(action);

  return (
    <form
      autoComplete="off"
      onSubmit={onSubmit}
      className="rounded-lg border border-neutral-200 bg-white   p-5 space-y-3"
    >
      <h3 className="text-ui-body font-bold text-neutral-800 ">{labels.embeddingTitle}</h3>

      <label className="block space-y-1">
        <span className="text-ui-caption font-medium text-neutral-500">{labels.embeddingProvider}</span>
        <select
          name="provider_id"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          disabled={pending}
          className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-ui-body focus-visible:border-sora-blue cursor-pointer"
        >
          <option value="">{labels.selectProvider}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-1">
        <span className="text-ui-caption font-medium text-neutral-500">{labels.embeddingModel}</span>
        <div className="flex items-center gap-2">
          <input
            id="embedding-model"
            ref={modelInputRef}
            name="model"
            aria-label={labels.embeddingModel}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={pending}
            placeholder="bge-m3"
            className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-ui-body font-mono focus-visible:border-sora-blue"
          />
          <UpstreamModelPicker
            fetchAction={fetchAction}
            providerId={providerId}
            inputRef={modelInputRef}
            filter={(m) => EMBEDDING_NAME_RE.test(m.id)}
          />
        </div>
        <p className="text-ui-caption text-ink-tertiary">{labels.embeddingHint}</p>
        <div className="min-h-4 text-ui-caption" aria-live="polite">
          {pending && <p className="text-neutral-600">{labels.saving}</p>}
          {!pending && status === "success" && <p role="status" className="text-success">{labels.saved}</p>}
          {!pending && status === "error" && <p role="alert" className="text-danger">{labels.saveFailed}</p>}
        </div>
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="px-4 py-2 font-semibold"
      >
        {pending ? labels.saving : labels.save}
      </Button>
    </form>
  );
}
