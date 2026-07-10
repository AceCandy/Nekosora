"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, Globe, Library, Wand2, Palette, X, Paperclip, SlidersHorizontal, Brain, Cpu, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { OptionPicker, type OptionItem } from "@/shared/ui/OptionPicker";
import type { ReasoningLevel, ModelCapabilities } from "@/db/types";
import type {
  ModelOption,
  CardOption,
  KnowledgeBaseOption,
  OutputModeOption,
  RenderStyleOption,
} from "@/features/chat/model/types";
import type { UploadFileItem } from "@/features/chat/model/types";
import type { PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";

/** 单选 picker 的统一触发器样式（与原 output mode / render style 一致）。 */
const SINGLE_TRIGGER_ACTIVE = "border-transparent bg-sora-blue/[0.04] text-sora-blue hover:bg-sora-blue/[0.08]";
const SINGLE_TRIGGER_IDLE = "border-transparent bg-transparent text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900";

/** 多选 picker 触发器样式（有选中高亮，与原指令卡 / 知识库一致）。 */
function multiTriggerClass(hasSelected: boolean): string {
  return clsx(
    "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
    hasSelected
      ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
      : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
  );
}

export interface ChatToolbarProps {
  // 模型选择（单选，必选不可清空，click 展开 + 向上弹出）
  models: ModelOption[];
  model: string;
  onModelChange: (name: string) => void;
  modelPickerOpen: boolean;
  onModelPickerToggle: () => void;
  onModelPickerClose: () => void;

  // 已上传附件(仅展示 chip)
  attached: UploadFileItem[];
  onRemoveAttachment: (id: string) => void;
  onPreviewFile: (file: PreviewableFile) => void;

  // 指令卡（多选）
  cards: CardOption[];
  selectedCardIds: string[];
  cardPickerOpen: boolean;
  onCardPickerToggle: () => void;
  onCardPickerClose: () => void;
  onCardToggle: (id: string) => void;

  // 知识库（多选）
  knowledgeBases: KnowledgeBaseOption[];
  selectedKbIds: string[];
  kbPickerOpen: boolean;
  onKbPickerToggle: () => void;
  onKbPickerClose: () => void;
  onKbToggle: (id: string) => void;

  // 输出模式（单选可清除）
  outputModes: OutputModeOption[];
  outputModeId: string | null;
  outputModePickerOpen: boolean;
  onOutputModePickerToggle: () => void;
  onOutputModePickerClose: () => void;
  onOutputModeToggle: (id: string) => void;
  onOutputModeClear: () => void;

  // 输出样式（单选可清除）
  renderStyles: RenderStyleOption[];
  renderStyleId: string | null;
  renderStylePickerOpen: boolean;
  onRenderStylePickerToggle: () => void;
  onRenderStylePickerClose: () => void;
  onRenderStyleToggle: (id: string) => void;
  onRenderStyleClear: () => void;

  // 联网搜索（纯 toggle，非 listbox）
  webSearch: boolean;
  onWebSearchToggle: () => void;

  // 模型参数（temperature/topP/maxTokens，null=用模型默认）
  modelParams: { temperature: number | null; topP: number | null; maxTokens: number | null };
  onModelParamsChange: (p: { temperature?: number | null; topP?: number | null; maxTokens?: number | null }) => void;
  onModelParamsReset: () => void;

  // 推理级别(仅可推理模型露出控件)
  reasoning: ReasoningLevel;
  onReasoningChange: (v: ReasoningLevel) => void;
}

/**
 * 工具栏段 —— 模型选择 + 文件上传 + 4 个 OptionPicker + 联网 toggle + 已选 chip 行。
 * 纯受控：所有状态由父组件持有，本组件只渲染并回传事件。
 */
export function ChatToolbar(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  const {
    models, model, onModelChange, modelPickerOpen, onModelPickerToggle, onModelPickerClose,
    attached, onRemoveAttachment, onPreviewFile,
    cards, selectedCardIds, cardPickerOpen, onCardPickerToggle, onCardPickerClose, onCardToggle,
    knowledgeBases, selectedKbIds, kbPickerOpen, onKbPickerToggle, onKbPickerClose, onKbToggle,
    outputModes, outputModeId, outputModePickerOpen, onOutputModePickerToggle, onOutputModePickerClose, onOutputModeToggle, onOutputModeClear,
    renderStyles, renderStyleId, renderStylePickerOpen, onRenderStylePickerToggle, onRenderStylePickerClose, onRenderStyleToggle, onRenderStyleClear,
    webSearch, onWebSearchToggle,
    modelParams, onModelParamsChange, onModelParamsReset,
    reasoning, onReasoningChange,
  } = props;

  // 当前选中模型的能力位(决定推理控件是否露出 + 档位)。
  const currentCapabilities = models.find((m) => m.name === model)?.capabilities;

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      {/* 模型选择（单选，必选不可清空，click 展开 + 向上弹出） */}
      <OptionPicker
        open={modelPickerOpen}
        onClose={onModelPickerClose}
        options={models.map((m): OptionItem => ({
          id: m.name,
          label: m.displayName ?? m.name,
          badge: m.source === "global" ? t("globalLabel") : undefined,
          badgeVariant: m.source === "global" ? "primary" : undefined,
        }))}
        selectedIds={model ? [model] : []}
        mode="single"
        onToggle={onModelChange}
        side="top"
        trigger={
          <button
            type="button"
            onClick={onModelPickerToggle}
            className={clsx(
              "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
              model ? SINGLE_TRIGGER_ACTIVE : SINGLE_TRIGGER_IDLE,
            )}
            title={t("selectModel")}
            aria-haspopup="listbox"
            aria-expanded={modelPickerOpen}
            aria-label={t("selectModel")}
          >
            <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="max-w-[140px] truncate">
              {model
                ? (models.find((m) => m.name === model)?.displayName ?? model)
                : t("selectModel")}
            </span>
            <ChevronDown className="w-3 h-3 opacity-50" aria-hidden="true" />
          </button>
        }
      />

      {/* 文件上传已改为粘贴/拖拽接入,工具栏不再显示上传按钮 */}

      {/* 指令卡（多选） */}
      {cards.length > 0 && (
        <OptionPicker
          open={cardPickerOpen}
          onClose={onCardPickerClose}
          options={cards.map((c): OptionItem => ({ id: c.id, label: c.title, description: c.description, badge: `/${c.trigger}` }))}
          selectedIds={selectedCardIds}
          mode="multi"
          onToggle={onCardToggle}
          trigger={
            <button
              type="button"
              onClick={onCardPickerToggle}
              className={multiTriggerClass(selectedCardIds.length > 0)}
              title={t("instructionCard")}
              aria-haspopup="listbox"
              aria-expanded={cardPickerOpen}
              aria-label="选择指令卡"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t("instructionCard")}{selectedCardIds.length > 0 ? ` (${selectedCardIds.length})` : ""}</span>
            </button>
          }
        />
      )}

      {/* 联网搜索 toggle（纯按钮，非 listbox） */}
      <button
        type="button"
        onClick={onWebSearchToggle}
        className={clsx(
          "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
          webSearch
            ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
            : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
        )}
        title={t("webSearch")}
        aria-pressed={webSearch}
        aria-label={t("webSearch")}
      >
        <Globe className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t("webSearch")}</span>
      </button>

      {/* 知识库（多选） */}
      {knowledgeBases.length > 0 && (
        <OptionPicker
          open={kbPickerOpen}
          onClose={onKbPickerClose}
          options={knowledgeBases.map((kb): OptionItem => ({ id: kb.id, label: kb.name, badge: `${kb.fileCount} 文件` }))}
          selectedIds={selectedKbIds}
          mode="multi"
          onToggle={onKbToggle}
          trigger={
            <button
              type="button"
              onClick={onKbPickerToggle}
              className={multiTriggerClass(selectedKbIds.length > 0)}
              title={t("knowledgeBase")}
              aria-haspopup="listbox"
              aria-expanded={kbPickerOpen}
              aria-label={t("knowledgeBase")}
            >
              <Library className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t("knowledgeBase")}{selectedKbIds.length > 0 ? ` (${selectedKbIds.length})` : ""}</span>
            </button>
          }
        />
      )}

      {/* 输出模式（单选可清除，hover 展开 + 向上弹出） */}
      {outputModes.length > 0 && (
        <OptionPicker
          open={outputModePickerOpen}
          onClose={onOutputModePickerClose}
          options={outputModes.map((m): OptionItem => ({ id: m.id, label: m.name, description: m.description }))}
          selectedIds={outputModeId ? [outputModeId] : []}
          mode="single"
          onToggle={onOutputModeToggle}
          onClear={onOutputModeClear}
          side="top"
          openOnHover
          trigger={
            <button
              type="button"
              onClick={onOutputModePickerToggle}
              className={clsx(
                "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                outputModeId ? SINGLE_TRIGGER_ACTIVE : SINGLE_TRIGGER_IDLE,
              )}
              title={t("outputMode")}
              aria-haspopup="listbox"
              aria-expanded={outputModePickerOpen}
              aria-label={t("outputMode")}
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {outputModeId
                  ? (outputModes.find((m) => m.id === outputModeId)?.name ?? t("outputMode"))
                  : t("outputMode")}
              </span>
            </button>
          }
        />
      )}

      {/* 输出样式（单选可清除，hover 展开 + 向上弹出） */}
      {renderStyles.length > 0 && (
        <OptionPicker
          open={renderStylePickerOpen}
          onClose={onRenderStylePickerClose}
          options={renderStyles.map((s): OptionItem => ({ id: s.id, label: s.name, description: s.description }))}
          selectedIds={renderStyleId ? [renderStyleId] : []}
          mode="single"
          onToggle={onRenderStyleToggle}
          onClear={onRenderStyleClear}
          side="top"
          openOnHover
          trigger={
            <button
              type="button"
              onClick={onRenderStylePickerToggle}
              className={clsx(
                "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
                renderStyleId ? SINGLE_TRIGGER_ACTIVE : SINGLE_TRIGGER_IDLE,
              )}
              title={t("renderStyle")}
              aria-haspopup="listbox"
              aria-expanded={renderStylePickerOpen}
              aria-label={t("renderStyle")}
            >
              <Palette className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {renderStyleId
                  ? (renderStyles.find((s) => s.id === renderStyleId)?.name ?? t("renderStyle"))
                  : t("renderStyle")}
              </span>
            </button>
          }
        />
      )}

      {/* 模型参数(temperature/topP/maxTokens) */}
      <ModelParamsPicker params={modelParams} onChange={onModelParamsChange} onReset={onModelParamsReset} />

      {/* 推理级别(仅可推理模型露出) */}
      <ReasoningPicker capabilities={currentCapabilities} value={reasoning} onChange={onReasoningChange} />

      {/* 已选指令卡 chip */}
      {selectedCardIds.map((id) => {
        const card = cards.find((c) => c.id === id);
        if (!card) return null;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 rounded-full border border-sora-blue/20 bg-sora-blue/[0.04] px-2.5 py-1 text-[11px] font-medium text-sora-blue"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="max-w-[100px] truncate">{card.title}</span>
            <button
              onClick={() => onCardToggle(id)}
              className="hover:opacity-75 p-1.5 -m-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sora-blue rounded-full cursor-pointer"
              title={t("attachRemove")}
              aria-label="移除指令卡"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </span>
        );
      })}

      {/* 附件 chip */}
      {attached.map((a) => {
        const isPreviewable = a.status === "uploaded" && a.fileId;
        return (
          <span
            key={a.id}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              a.status === "uploaded" && "bg-sora-blue/[0.04] border-sora-blue/20 text-sora-blue",
              a.status === "uploading" && "bg-neutral-100 dark:bg-neutral-900 border-morning-mist dark:border-deep-space text-neutral-500",
              a.status === "pending" && "bg-neku-amber/[0.04] border-neku-amber/20 text-neku-amber",
              a.status === "error" && "bg-red-500/[0.04] border-red-500/20 text-red-500",
            )}
          >
            <button
              type="button"
              disabled={!isPreviewable}
              onClick={() => isPreviewable && onPreviewFile({ fileId: a.fileId!, filename: a.filename, mime: guessMime(a.filename) })}
              className="inline-flex items-center gap-1.5 disabled:cursor-default enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded"
              title={isPreviewable ? t("attachPreview") : undefined}
            >
              {a.status === "uploading" ? (
                <Loader2 className="w-3.5 h-3.5 text-neutral-400 animate-spin" aria-hidden="true" />
              ) : a.isImage && a.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewUrl} alt={a.filename} className="w-4 h-4 rounded-sm object-cover shrink-0" />
              ) : (
                <Paperclip className={clsx(
                  "w-3 h-3",
                  a.status === "uploaded" && "text-sora-blue",
                  a.status === "pending" && "text-neku-amber",
                  a.status === "error" && "text-red-500",
                )} aria-hidden="true" />
              )}
              <span className="max-w-[120px] truncate" title={a.filename}>
                {a.filename}
                {a.status === "pending" && ` ${t("attachPending")}`}
                {a.status === "uploading" && ` ${t("attachUploading")}`}
                {a.status === "error" && ` ${t("attachError")}`}
              </span>
            </button>
            <button
              onClick={() => onRemoveAttachment(a.id)}
              className="hover:opacity-75 font-semibold p-1.5 -m-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-850 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sora-blue cursor-pointer"
              title={t("attachRemove")}
              aria-label="移除附件"
            >
              <X className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** 模型参数调节 picker：temperature / topP / maxTokens,空值用模型默认。 */
function ModelParamsPicker({
  params,
  onChange,
  onReset,
}: {
  params: { temperature: number | null; topP: number | null; maxTokens: number | null };
  onChange: (p: { temperature?: number | null; topP?: number | null; maxTokens?: number | null }) => void;
  onReset: () => void;
}) {
  const t = useTranslations("chat");
  const [open, setOpen] = useState(false);
  const hasCustom = params.temperature !== null || params.topP !== null || params.maxTokens !== null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
          hasCustom
            ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
            : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
        )}
        title={t("modelParams")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("modelParams")}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t("modelParams")}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-2 left-0 z-40 w-64 rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink p-3 shadow-md space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t("modelParams")}</span>
              {hasCustom && (
                <button
                  type="button"
                  onClick={onReset}
                  className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 underline underline-offset-2 cursor-pointer"
                >
                  {t("resetDefaults")}
                </button>
              )}
            </div>
            <ParamInput label={t("temperature")} value={params.temperature} min={0} max={2} step={0.1} onChange={(v) => onChange({ temperature: v })} />
            <ParamInput label={t("topP")} value={params.topP} min={0} max={1} step={0.05} onChange={(v) => onChange({ topP: v })} />
            <ParamInput label={t("maxTokens")} value={params.maxTokens} min={1} step={1} onChange={(v) => onChange({ maxTokens: v })} />
          </div>
        </>
      )}
    </div>
  );
}

/** 推理级别 picker:仅当模型 capabilities.reasoning===true 时渲染;档位按 thinkingLevelMap 动态。 */
function ReasoningPicker({
  capabilities,
  value,
  onChange,
}: {
  capabilities?: ModelCapabilities;
  value: ReasoningLevel;
  onChange: (v: ReasoningLevel) => void;
}) {
  const t = useTranslations("chat");
  const [open, setOpen] = useState(false);
  if (!capabilities?.reasoning) return null;
  // 支持档位:无 map → 全档;有 map → 非 null 的档(undefined=回退默认,也算支持)
  const map = capabilities.thinkingLevelMap;
  const levels = (["low", "medium", "high"] as const).filter((lvl) => !map || map[lvl] !== null);
  const active = value !== "off";
  const labelKey = value === "off" ? "reasoningOff" : value === "low" ? "reasoningLow" : value === "medium" ? "reasoningMedium" : "reasoningHigh";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer",
          active
            ? "border-sora-blue/30 bg-sora-blue/[0.04] text-sora-blue"
            : "border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
        )}
        title={t("reasoning")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("reasoning")}
      >
        <Brain className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t(labelKey)}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-2 right-0 z-40 w-40 rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink p-1.5 shadow-md">
            {(["off", ...levels] as ReasoningLevel[]).map((lvl) => {
              const key = lvl === "off" ? "reasoningOff" : lvl === "low" ? "reasoningLow" : lvl === "medium" ? "reasoningMedium" : "reasoningHigh";
              const selected = value === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => { onChange(lvl); setOpen(false); }}
                  className={clsx(
                    "w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer",
                    selected ? "bg-sora-blue/[0.08] text-sora-blue font-semibold" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                  )}
                >
                  {t(key)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ParamInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
        placeholder="默认"
        className="w-24 rounded border border-morning-mist dark:border-deep-space/80 bg-transparent px-2 py-1 text-xs text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue"
      />
    </label>
  );
}

/** 按扩展名粗略推断 mime（从 ChatComposer 原样迁入）。 */
function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
    mp4: "video/mp4", webm: "video/webm",
    txt: "text/plain", md: "text/markdown",
    json: "application/json", xml: "application/xml",
    js: "text/javascript", ts: "text/typescript", tsx: "text/typescript",
    py: "text/x-python", go: "text/x-go", rs: "text/rust",
    html: "text/html", css: "text/css",
    yaml: "application/x-yaml", yml: "application/x-yaml",
    csv: "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}
