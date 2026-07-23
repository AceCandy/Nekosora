"use client";

import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, Globe, Library, Wand2, Palette, X, Paperclip, Brain, ChevronDown, Plus } from "lucide-react";
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
import { getSupportedReasoningLevels } from "@/lib/reasoning";
import { useClickOutside } from "@/shared/lib/useClickOutside";

const MENU_ROW = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-neutral-200 dark:hover:bg-neutral-900";
/** 输入栏内联控件:与发送按钮同高,无多余描边框。 */
const TOOLBAR_CHIP =
  "pointer-events-auto inline-flex h-8 max-w-28 items-center gap-1 rounded-full px-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-800 sm:max-w-40";
const TOOLBAR_ICON =
  "pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

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

  // 推理级别(仅可推理模型露出控件)
  reasoning: ReasoningLevel;
  onReasoningChange: (v: ReasoningLevel) => void;
}

/** 仅在存在选择或附件时展示紧凑状态行。 */
export function ChatToolbar(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  const {
    attached, onRemoveAttachment, onPreviewFile,
    cards, selectedCardIds, onCardToggle,
    knowledgeBases, selectedKbIds, onKbToggle,
  } = props;
  if (selectedCardIds.length === 0 && selectedKbIds.length === 0 && attached.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2">
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

      {selectedKbIds.map((id) => {
        const kb = knowledgeBases.find((item) => item.id === id);
        if (!kb) return null;
        return (
          <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-sora-blue/20 bg-sora-blue/[0.04] px-2.5 py-1 text-[11px] font-medium text-sora-blue">
            <Library className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-w-[100px] truncate">{kb.name}</span>
            <button onClick={() => onKbToggle(id)} className="-m-1 rounded-full p-1.5 hover:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sora-blue" title={t("attachRemove")} aria-label="移除知识库">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
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

/** 输入框左侧加号菜单：输出模式、输出样式，以及原有指令卡/知识库入口。 */
export function ComposerPlusMenu(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    props.onOutputModePickerClose();
    props.onRenderStylePickerClose();
    props.onCardPickerClose();
    props.onKbPickerClose();
  };
  useClickOutside(rootRef, close, open);
  return (
    <div ref={rootRef} className="pointer-events-auto relative shrink-0">
      <button type="button" onClick={() => { if (open) close(); else setOpen(true); }} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 transition-colors duration-200 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-900" aria-label="更多设置" aria-expanded={open}>
        <Plus className="h-4.5 w-4.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 space-y-1 rounded-lg border border-morning-mist bg-white p-1.5 shadow-lg dark:border-deep-space dark:bg-space-ink">
          {props.outputModes.length > 0 && <OptionPicker open={props.outputModePickerOpen} onClose={props.onOutputModePickerClose} options={props.outputModes.map((item): OptionItem => ({ id: item.id, label: item.name, description: item.description }))} selectedIds={props.outputModeId ? [props.outputModeId] : []} mode="single" onToggle={props.onOutputModeToggle} onClear={props.onOutputModeClear} side="top" trigger={<button type="button" onClick={props.onOutputModePickerToggle} className={MENU_ROW}><Wand2 className="h-4 w-4" aria-hidden="true" /><span className="flex-1">{t("outputMode")}</span><span className="max-w-20 truncate text-neutral-400">{props.outputModes.find((item) => item.id === props.outputModeId)?.name}</span></button>} />}
          {props.renderStyles.length > 0 && <OptionPicker open={props.renderStylePickerOpen} onClose={props.onRenderStylePickerClose} options={props.renderStyles.map((item): OptionItem => ({ id: item.id, label: item.name, description: item.description }))} selectedIds={props.renderStyleId ? [props.renderStyleId] : []} mode="single" onToggle={props.onRenderStyleToggle} onClear={props.onRenderStyleClear} side="top" trigger={<button type="button" onClick={props.onRenderStylePickerToggle} className={MENU_ROW}><Palette className="h-4 w-4" aria-hidden="true" /><span className="flex-1">{t("renderStyle")}</span><span className="max-w-20 truncate text-neutral-400">{props.renderStyles.find((item) => item.id === props.renderStyleId)?.name}</span></button>} />}
          {props.cards.length > 0 && <OptionPicker open={props.cardPickerOpen} onClose={props.onCardPickerClose} options={props.cards.map((item): OptionItem => ({ id: item.id, label: item.title, description: item.description, badge: `/${item.trigger}` }))} selectedIds={props.selectedCardIds} mode="multi" onToggle={props.onCardToggle} side="top" trigger={<button type="button" onClick={props.onCardPickerToggle} className={MENU_ROW}><Sparkles className="h-4 w-4" aria-hidden="true" /><span className="flex-1">{t("instructionCard")}</span>{props.selectedCardIds.length > 0 && <span className="text-sora-blue">{props.selectedCardIds.length}</span>}</button>} />}
          {props.knowledgeBases.length > 0 && <OptionPicker open={props.kbPickerOpen} onClose={props.onKbPickerClose} options={props.knowledgeBases.map((item): OptionItem => ({ id: item.id, label: item.name, badge: `${item.fileCount} 文件` }))} selectedIds={props.selectedKbIds} mode="multi" onToggle={props.onKbToggle} side="top" trigger={<button type="button" onClick={props.onKbPickerToggle} className={MENU_ROW}><Library className="h-4 w-4" aria-hidden="true" /><span className="flex-1">{t("knowledgeBase")}</span>{props.selectedKbIds.length > 0 && <span className="text-sora-blue">{props.selectedKbIds.length}</span>}</button>} />}
        </div>
      )}
    </div>
  );
}

/**
 * 输入框右侧模型相关控件(内联,无中间层菜单框):
 * 推理档位 / 联网 + 模型名(点开直接出模型列表)。
 */
export function ModelControlMenu(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  const current = props.models.find((item) => item.modelId === props.model);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <div className="hidden sm:block">
        <ReasoningPicker
          capabilities={current?.capabilities}
          value={props.reasoning}
          onChange={props.onReasoningChange}
        />
      </div>
      <div className="hidden sm:block">
        <button
          type="button"
          onClick={props.onWebSearchToggle}
          className={clsx(TOOLBAR_ICON, props.webSearch && "bg-sora-blue/[0.08] text-sora-blue hover:bg-sora-blue/[0.12] hover:text-sora-blue dark:hover:bg-sora-blue/[0.12] dark:hover:text-sora-blue")}
          aria-pressed={props.webSearch}
          aria-label={t("webSearch")}
          title={t("webSearch")}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <OptionPicker
        open={props.modelPickerOpen}
        onClose={props.onModelPickerClose}
        options={props.models.map((item): OptionItem => ({
          id: item.modelId,
          label: item.displayName ?? item.name,
          badge: item.source === "global" ? t("globalLabel") : undefined,
          badgeVariant: item.source === "global" ? "primary" : undefined,
        }))}
        selectedIds={props.model ? [props.model] : []}
        mode="single"
        onToggle={props.onModelChange}
        side="top"
        align="right"
        panelClassName="w-64 max-h-72 overflow-y-auto"
        trigger={
          <button
            type="button"
            onClick={props.onModelPickerToggle}
            className={clsx(TOOLBAR_CHIP, "text-neutral-700 dark:text-neutral-200")}
            aria-label={t("selectModel")}
            aria-expanded={props.modelPickerOpen}
          >
            <span className="truncate">{current?.displayName ?? current?.name ?? t("selectModel")}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}

/** 推理档位:输入栏紧凑 chip,仅可推理模型显示。 */
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
  const rootRef = useRef<HTMLDivElement>(null);
  const levels = getSupportedReasoningLevels(capabilities);
  // hooks 须在 early return 前调用;不支持推理时 enabled=false,不挂监听。
  const visible =
    Boolean(capabilities?.reasoning) &&
    levels.length > 0 &&
    !(levels.length === 1 && levels[0] === "off");
  useClickOutside(rootRef, () => setOpen(false), open && visible);
  if (!visible) return null;
  const fixed = levels.length === 1;
  const active = value !== "off";
  const labelKey = reasoningLabelKey(value, fixed);
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => { if (!fixed) setOpen((v) => !v); }}
        disabled={fixed}
        className={clsx(
          TOOLBAR_CHIP,
          fixed ? "cursor-default opacity-80" : "cursor-pointer",
          active && "bg-sora-blue/[0.08] text-sora-blue hover:bg-sora-blue/[0.12] dark:hover:bg-sora-blue/[0.12]",
        )}
        title={t("reasoning")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("reasoning")}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{t(labelKey)}</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-40 rounded-lg border border-morning-mist bg-white p-1.5 shadow-md dark:border-deep-space/80 dark:bg-space-ink">
          {levels.map((lvl) => {
            const key = reasoningLabelKey(lvl, false);
            const selected = value === lvl;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => { onChange(lvl); setOpen(false); }}
                className={clsx(
                  "w-full cursor-pointer rounded px-2.5 py-1.5 text-left text-xs transition-colors",
                  selected
                    ? "bg-sora-blue/[0.08] font-semibold text-sora-blue"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900",
                )}
              >
                {t(key)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function reasoningLabelKey(level: ReasoningLevel, fixed: boolean) {
  if (fixed) return "reasoningFixed";
  switch (level) {
    case "off": return "reasoningOff";
    case "minimal": return "reasoningMinimal";
    case "low": return "reasoningLow";
    case "medium": return "reasoningMedium";
    case "high": return "reasoningHigh";
    case "xhigh": return "reasoningXHigh";
    case "max": return "reasoningMax";
  }
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
