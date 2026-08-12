"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Globe, Library, Wand2, Palette, X, File as FileIcon, Brain, ChevronDown, Plus, Search, Check, Paperclip } from "lucide-react";
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
  "pointer-events-auto inline-flex h-8 max-w-20 items-center gap-1 rounded-full px-2 text-ui-caption font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-800 sm:max-w-52";
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

  // 已上传附件
  attached: UploadFileItem[];
  onUploadFiles: (files: FileList | File[] | null) => void;
  onRemoveAttachment: (id: string) => void;
  onPreviewFile: (file: PreviewableFile) => void;

  // 指令卡（多选）
  cards: CardOption[];
  selectedCardIds: string[];
  onCardToggle: (id: string) => void;

  // 知识库（多选）
  knowledgeBases: KnowledgeBaseOption[];
  selectedKbIds: string[];
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
  webSearchAvailable: boolean;
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
    <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2">
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

      {/* 附件信息卡 */}
      {attached.map((a) => {
        const isPreviewable = a.status === "uploaded" && Boolean(a.fileId);
        const statusLabel = a.status === "pending"
          ? t("attachPending")
          : a.status === "uploading"
            ? t("attachUploading")
            : a.status === "error"
              ? t("attachError")
              : null;
        const metadata = [
          attachmentKind(a),
          formatFileSize(a.file?.size),
          statusLabel,
        ].filter(Boolean).join(" · ");
        return (
          <div
            key={a.id}
            className={clsx(
              "relative flex h-16 w-60 max-w-full min-w-0 items-center rounded-lg p-2 pr-12 transition-colors",
              a.status === "uploaded" && "bg-neutral-100 dark:bg-white/[0.06]",
              a.status === "uploading" && "bg-neutral-100 dark:bg-white/[0.06]",
              a.status === "pending" && "bg-neku-amber/[0.06]",
              a.status === "error" && "bg-red-500/[0.06]",
            )}
          >
            <button
              type="button"
              disabled={!isPreviewable}
              onClick={() => isPreviewable && onPreviewFile({ fileId: a.fileId!, filename: a.filename, mime: a.file?.type || guessMime(a.filename) })}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left disabled:cursor-default enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
              title={isPreviewable ? t("attachPreview") : undefined}
            >
              {a.isImage && a.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewUrl} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white text-neutral-500 dark:bg-space-ink dark:text-neutral-400">
                  <FileIcon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-body font-medium text-space-ink dark:text-nebula-silver" title={a.filename}>
                  {a.filename}
                </span>
                <span className={clsx(
                  "block truncate text-ui-caption font-normal text-neutral-600 dark:text-neutral-400",
                  a.status === "pending" && "text-neku-amber dark:text-neku-amber",
                  a.status === "error" && "text-red-500 dark:text-red-400",
                )}>
                  {metadata}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemoveAttachment(a.id)}
              className="touch-target absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-black/[0.05] hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
              title={t("attachRemove")}
              aria-label="移除附件"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 会话标题后的输出样式入口。 */
export function RenderStyleMenu(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  if (props.renderStyles.length === 0) return null;

  return (
    <OptionPicker
      open={props.renderStylePickerOpen}
      onClose={props.onRenderStylePickerClose}
      options={props.renderStyles.map((item): OptionItem => ({ id: item.id, label: item.name, description: item.description }))}
      selectedIds={props.renderStyleId ? [props.renderStyleId] : []}
      mode="single"
      onToggle={props.onRenderStyleToggle}
      onClear={props.onRenderStyleClear}
      side="bottom"
      align="left"
      trigger={(
        <button
          type="button"
          onClick={props.onRenderStylePickerToggle}
          className="touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-space-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-nebula-silver"
          aria-label={t("renderStyle")}
          title={t("renderStyle")}
          aria-haspopup="listbox"
          aria-expanded={props.renderStylePickerOpen}
        >
          <Palette className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    />
  );
}

/** 输入框左侧加号菜单：暂时只保留文件上传入口。 */
export function ComposerPlusMenu(props: ChatToolbarProps) {
  const t = useTranslations("chat");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => setOpen(false);
  useClickOutside(rootRef, close, open);
  return (
    <div ref={rootRef} className="pointer-events-auto relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          props.onUploadFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <button type="button" onClick={() => { if (open) close(); else setOpen(true); }} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 transition-colors duration-200 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-neutral-900" aria-label="更多设置" aria-haspopup="menu" aria-expanded={open}>
        <Plus className="h-4.5 w-4.5" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-20 mb-2 w-48 rounded-lg border border-morning-mist bg-white p-1.5 shadow-lg dark:border-deep-space dark:bg-space-ink">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              inputRef.current?.click();
            }}
            className={MENU_ROW}
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            <span>{t("uploadAttachment")}</span>
          </button>
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
      {props.outputModes.length > 0 && (
        <OptionPicker
          open={props.outputModePickerOpen}
          onClose={props.onOutputModePickerClose}
          options={props.outputModes.map((item): OptionItem => ({ id: item.id, label: item.name, description: item.description }))}
          selectedIds={props.outputModeId ? [props.outputModeId] : []}
          mode="single"
          onToggle={props.onOutputModeToggle}
          onClear={props.onOutputModeClear}
          side="top"
          align="right"
          trigger={(
            <button
              type="button"
              onClick={props.onOutputModePickerToggle}
              className={clsx(TOOLBAR_ICON, props.outputModeId && "bg-sora-blue/[0.08] text-sora-blue hover:bg-sora-blue/[0.12] hover:text-sora-blue dark:hover:bg-sora-blue/[0.12] dark:hover:text-sora-blue")}
              aria-label={t("outputMode")}
              title={t("outputMode")}
              aria-haspopup="listbox"
              aria-expanded={props.outputModePickerOpen}
            >
              <Wand2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        />
      )}
      {props.webSearchAvailable && <div className="hidden sm:block">
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
      </div>}
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

function attachmentKind(item: UploadFileItem): string {
  const filenameParts = item.filename.split(".");
  const extension = filenameParts.length > 1 ? filenameParts.pop() : undefined;
  const mimeSubtype = item.file?.type.split("/").pop();
  return (extension || mimeSubtype || "FILE").toUpperCase();
}

function formatFileSize(bytes?: number): string | null {
  if (bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
