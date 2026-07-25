"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, Globe, Library, Wand2, Palette, X, Paperclip, Brain, ChevronDown, Plus, Search, Check } from "lucide-react";
import { clsx } from "clsx";
import { OptionPicker, type OptionItem } from "@/shared/ui/OptionPicker";
import { Popover } from "@/shared/ui/Popover";
import { Badge } from "@/shared/ui/Badge";
import type { ReasoningLevel } from "@/db/types";
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

const MENU_ROW = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-ui-caption font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-neutral-200 dark:hover:bg-neutral-900";
/** 输入栏内联控件:与发送按钮同高,无多余描边框。 */
const TOOLBAR_CHIP =
  "pointer-events-auto inline-flex h-8 max-w-28 items-center gap-1 rounded-full px-2 text-ui-caption font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-800 sm:max-w-52";
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
            className="inline-flex items-center gap-1.5 rounded-full border border-sora-blue/20 bg-sora-blue/[0.04] px-2.5 py-1 text-ui-caption font-medium text-sora-blue"
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
          <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-sora-blue/20 bg-sora-blue/[0.04] px-2.5 py-1 text-ui-caption font-medium text-sora-blue">
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
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-ui-caption font-medium transition-colors",
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
 * 输入框右侧模型相关控件:联网独立开关 + 模型配置入口。
 * 推理档位从属于具体模型,统一收进模型浮层。
 */
export function ModelControlMenu(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  const current = props.models.find((item) => item.modelId === props.model);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
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
      <ModelConfigPicker
        {...props}
        current={current}
      />
    </div>
  );
}

interface ModelConfigPickerProps extends ChatToolbarProps {
  current?: ModelOption;
}

function ModelConfigPicker(props: ModelConfigPickerProps) {
  const t = useTranslations("chat");
  const [query, setQuery] = useState("");
  const [reasoningDraft, setReasoningDraft] = useState<{ modelId: string; index: number } | null>(null);
  const pendingReasoningRef = useRef<{ modelId: string; level: ReasoningLevel } | null>(null);
  const levels = getSupportedReasoningLevels(props.current?.capabilities);
  const reasoningVisible =
    Boolean(props.current?.capabilities?.reasoning) &&
    levels.length > 0 &&
    !(levels.length === 1 && levels[0] === "off");
  const fixed = levels.length === 1;
  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return props.models;
    return props.models.filter((item) => {
      const label = item.displayName ?? item.name;
      return label.toLocaleLowerCase().includes(normalized)
        || item.name.toLocaleLowerCase().includes(normalized);
    });
  }, [props.models, query]);
  const close = () => {
    setQuery("");
    setReasoningDraft(null);
    props.onModelPickerClose();
  };
  const statusLabel = reasoningVisible
    ? t(reasoningShortLabelKey(props.reasoning, fixed))
    : null;
  const selectedReasoningIndex = Math.max(0, levels.indexOf(props.reasoning));
  const draftReasoningIndex = reasoningDraft?.modelId === props.model
    ? reasoningDraft.index
    : selectedReasoningIndex;
  const displayedReasoningIndex = Math.max(0, Math.min(draftReasoningIndex, Math.max(0, levels.length - 1)));
  const displayedReasoning = levels[displayedReasoningIndex];
  const reasoningProgress = levels.length > 1
    ? (displayedReasoningIndex / (levels.length - 1)) * 100
    : 0;
  const commitReasoning = (index: number) => {
    const level = levels[Math.max(0, Math.min(index, levels.length - 1))];
    setReasoningDraft(null);
    if (!level || level === props.reasoning) return;
    const pending = pendingReasoningRef.current;
    if (pending?.modelId === props.model && pending.level === level) return;
    pendingReasoningRef.current = { modelId: props.model, level };
    props.onReasoningChange(level);
  };
  useEffect(() => {
    const pending = pendingReasoningRef.current;
    if (pending?.modelId !== props.model || pending?.level === props.reasoning) {
      pendingReasoningRef.current = null;
    }
  }, [props.model, props.reasoning]);

  return (
    <Popover
      open={props.modelPickerOpen}
      onClose={close}
      side="top"
      align="right"
      panelZ="z-40"
      panelClassName="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      trigger={
        <button
          type="button"
          onClick={() => { if (props.modelPickerOpen) close(); else props.onModelPickerToggle(); }}
          className={clsx(TOOLBAR_CHIP, "cursor-pointer text-neutral-700 dark:text-neutral-200")}
          aria-label={t("modelSettings")}
          aria-haspopup="dialog"
          aria-expanded={props.modelPickerOpen}
        >
          <span className="truncate">{props.current?.displayName ?? props.current?.name ?? t("selectModel")}</span>
          {statusLabel && (
            <span className="hidden shrink-0 text-neutral-400 dark:text-neutral-500 sm:inline">
              · {statusLabel}
            </span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      }
    >
      <div role="dialog" aria-label={t("modelSettings")}>
        <div className="relative border-b border-morning-mist p-2 dark:border-deep-space/80">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("modelSearchPlaceholder")}
            aria-label={t("modelSearchPlaceholder")}
            className="h-8 w-full rounded-md border border-morning-mist bg-nebula-white pl-8 pr-3 text-ui-caption text-space-ink outline-none transition-colors placeholder:text-neutral-500 focus:border-sora-blue focus-visible:ring-2 focus-visible:ring-sora-blue/20 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver"
          />
        </div>

        <div role="listbox" aria-label={t("selectModel")} className="max-h-56 overflow-y-auto p-1.5">
          {filteredModels.length > 0 ? filteredModels.map((item) => {
            const selected = item.modelId === props.model;
            return (
              <button
                key={item.modelId}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setReasoningDraft(null);
                  props.onModelChange(item.modelId);
                }}
                className={clsx(
                  "touch-target flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-ui-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
                  selected
                    ? "bg-sora-blue/[0.06] font-semibold text-sora-blue"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900",
                )}
              >
                <Check className={clsx("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.displayName ?? item.name}</span>
                {item.source === "global" && (
                  <Badge variant="primary" className="shrink-0 py-0 leading-none">{t("globalLabel")}</Badge>
                )}
              </button>
            );
          }) : (
            <div className="px-3 py-8 text-center text-ui-caption text-neutral-500 dark:text-neutral-400">
              {t("modelSearchNoMatch")}
            </div>
          )}
        </div>

        {reasoningVisible && (
          <div className="border-t border-morning-mist bg-neutral-50/80 px-2 py-1.5 dark:border-deep-space dark:bg-twilight-obsidian/60">
            <div className="flex items-center gap-2">
              <span className="mt-2 inline-flex shrink-0 items-center self-start text-neutral-600 dark:text-neutral-300" title={t("reasoning")}>
                <Brain className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              {fixed && (
                <span className="ml-auto text-ui-caption text-neutral-500 dark:text-neutral-400">
                  {t("reasoningFixedShort")}
                </span>
              )}
              {!fixed && (
                <div className="relative h-11 min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-x-3 top-3 h-1.5 rounded-full" style={{ background: "linear-gradient(to right, var(--color-nebula-white), var(--color-sora-blue), var(--color-neku-amber))" }}>
                    <span
                      className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md dark:border-space-ink"
                      style={{
                        left: `${reasoningProgress}%`,
                        background: "linear-gradient(to bottom, var(--color-nebula-white) 55%, var(--color-neku-amber))",
                      }}
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-x-3 bottom-0 h-4">
                    {levels.map((level, index) => (
                      <span
                        key={level}
                        className={clsx(
                          "absolute top-0 whitespace-nowrap text-ui-micro font-medium",
                          index === 0 ? "text-left" : index === levels.length - 1 ? "-translate-x-full text-right" : "-translate-x-1/2 text-center",
                          index === displayedReasoningIndex
                            ? "text-space-ink dark:text-nebula-silver"
                            : "text-neutral-500 dark:text-neutral-400",
                        )}
                        style={{ left: `${(index / (levels.length - 1)) * 100}%` }}
                      >
                        {t(reasoningShortLabelKey(level, false))}
                      </span>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={levels.length - 1}
                    step={1}
                    value={displayedReasoningIndex}
                    onChange={(event) => setReasoningDraft({ modelId: props.model, index: Number(event.currentTarget.value) })}
                    onPointerUp={(event) => commitReasoning(Number(event.currentTarget.value))}
                    onPointerCancel={() => setReasoningDraft(null)}
                    onKeyUp={(event) => {
                      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                        commitReasoning(Number(event.currentTarget.value));
                      }
                    }}
                    onBlur={(event) => commitReasoning(Number(event.currentTarget.value))}
                    aria-label={t("reasoningLevel")}
                    aria-valuetext={displayedReasoning ? t(reasoningShortLabelKey(displayedReasoning, false)) : undefined}
                    className="touch-target absolute inset-x-0 top-0 h-7 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0 [&::-moz-range-track]:h-6 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-6 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}

function reasoningShortLabelKey(level: ReasoningLevel, fixed: boolean) {
  if (fixed) return "reasoningFixedShort";
  switch (level) {
    case "off": return "reasoningOffShort";
    case "minimal": return "reasoningMinimalShort";
    case "low": return "reasoningLowShort";
    case "medium": return "reasoningMediumShort";
    case "high": return "reasoningHighShort";
    case "xhigh": return "reasoningXHighShort";
    case "max": return "reasoningMaxShort";
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
