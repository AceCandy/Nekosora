"use client";

import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { Wrench, Eye, MessageSquare, Image as ImageIcon, Mic, Volume2 } from "lucide-react";
import type { ModelCatalogOption } from "@/features/models/ModelsManager";
import type { ReasoningLevel } from "@nekusora/db/types";
import { getSupportedReasoningLevels } from "@nekusora/core/reasoning";
import Badge from "@/shared/ui/Badge";
import { useId, useOptimistic, useState, useTransition } from "react";
import { setCatalogImageGeneration } from "./catalog-actions";

/** 全部推理档位,供逐档可视化高亮支持的档位。 */
const ALL_LEVELS: ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * 模型模板详情卡片:类型 + 能力矩阵 + 推理档位可视化。
 * 列表 hover 浮层与编辑表单预览弹窗复用同一份内容。
 */
interface CatalogDetailCardProps {
  catalog: ModelCatalogOption;
  editable?: boolean;
}

export default function CatalogDetailCard({ catalog, editable = false }: CatalogDetailCardProps) {
  const t = useTranslations("models.catalogDetail");
  const c = catalog.capabilities;
  const hintId = useId();
  const [imageFormat, setImageFormat] = useOptimistic(c.imageGeneration ? c.imageGenerationFormat ?? "openai-images" : "off");
  const [pending, startTransition] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);
  const supportedLevels = getSupportedReasoningLevels(c);

  const typeMap: Record<string, string> = {
    chat: t("typeChat"),
    image: t("typeImage"),
    embedding: t("typeEmbedding"),
    rerank: t("typeRerank"),
    audio: t("typeAudio"),
  };

  const caps = [
    { key: "tools", on: c.tools, label: t("capTools"), Icon: Wrench },
    { key: "vision", on: c.vision, label: t("capVision"), Icon: Eye },
    { key: "systemPrompt", on: c.systemPrompt, label: t("capSystemPrompt"), Icon: MessageSquare },
    { key: "imageGeneration", on: imageFormat !== "off", label: t("capImageGen"), Icon: ImageIcon },
    { key: "audioTranscription", on: c.audioTranscription, label: t("capAudioSTT"), Icon: Mic },
    { key: "audioSynthesis", on: c.audioSynthesis, label: t("capAudioTTS"), Icon: Volume2 },
  ].filter((x) => x.on);

  return (
    <div className="w-72 max-w-full space-y-2.5 text-ui-caption">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold text-neutral-800 ">{catalog.name}</span>
        <Badge variant="neutral">{typeMap[catalog.modelType] ?? catalog.modelType}</Badge>
      </div>

      {editable && (
        <div className="space-y-2 border-t border-morning-mist pt-2.5">
          <label className="block space-y-1.5">
            <span className="text-space-ink">{t("imageGenerationLabel")}</span>
            <select
              value={imageFormat}
              className="w-full rounded-md border border-morning-mist bg-white px-3 py-2 text-ui-body text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue disabled:opacity-50"
              disabled={pending}
              aria-describedby={hintId}
              aria-busy={pending}
              onChange={(event) => {
                const value = event.target.value;
                if (value !== "off" && value !== "openai-images" && value !== "openai-responses") return;
                setSaveFailed(false);
                startTransition(async () => {
                  setImageFormat(value);
                  try {
                    await setCatalogImageGeneration(catalog.id, value !== "off", value === "off" ? undefined : value);
                  } catch {
                    setSaveFailed(true);
                  }
                });
              }}
            >
              <option value="off">{t("imageGenerationOff")}</option>
              <option value="openai-images">{t("imageGenerationImages")}</option>
              <option value="openai-responses">{t("imageGenerationResponses")}</option>
            </select>
          </label>
          <p id={hintId} className="leading-relaxed text-ink-secondary">{t("imageGenerationHint")}</p>
          {saveFailed && <p role="alert" className="text-danger">{t("imageGenerationSaveFailed")}</p>}
        </div>
      )}

      <div>
        <div className="mb-1 text-ui-caption text-neutral-500">{t("capabilities")}</div>
        {caps.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {caps.map(({ key, label, Icon }) => (
              <Badge key={key} variant="primary">
                <Icon className="mr-0.5 h-2.5 w-2.5" />
                {label}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-ui-caption text-neutral-500">—</span>
        )}
      </div>

      <div>
        <div className="mb-1 text-ui-caption text-neutral-500">{t("reasoning")}</div>
        {c.reasoning ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
              {ALL_LEVELS.map((lv) => {
                const supported = supportedLevels.includes(lv);
                return (
                  <span
                    key={lv}
                    className={clsx(
                      "rounded border px-1.5 py-0.5 text-ui-caption",
                      supported
                        ? "border-sora-blue/30 bg-sora-blue/10 text-sora-blue"
                        : "border-neutral-200 bg-neutral-50 text-neutral-400   ",
                    )}
                  >
                    {lv}
                  </span>
                );
              })}
            </div>
            {c.thinkingFormat && (
              <div className="text-ui-caption text-neutral-500">
                {t("reasoningFormat")}: <span className="font-mono text-neutral-500 ">{c.thinkingFormat}</span>
              </div>
            )}
          </div>
        ) : (
          <span className="text-ui-caption text-neutral-500">{t("reasoningNotSupported")}</span>
        )}
      </div>
    </div>
  );
}
