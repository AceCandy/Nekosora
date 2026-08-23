"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AudioLines, Square } from "lucide-react";
import { AIArrowUpIcon } from "@/shared/components/animated-icons";
import { clsx } from "clsx";
import type { CardOption } from "@/features/chat/model/types";
import { useSpeechInput } from "@/features/chat/model/useSpeechInput";

interface ChatInputBoxProps {
  value: string;
  onChange: (v: string) => void;
  /** 发送（Enter 或点击发送按钮）。 */
  onSend: () => void;
  /** 存在附件时允许空文本发送。 */
  hasAttachments?: boolean;
  /** 流式中（显示停止按钮、关闭斜杠命令；输入框保持可输入，Enter 转为排队）。 */
  disabled: boolean;
  /** 停止生成。 */
  onStop: () => void;
  /** 粘贴图片文件时触发（传入图片 File 数组）。 */
  onPasteFiles: (files: File[]) => void;
  /** 拖拽文件时触发。 */
  onDropFiles: (files: File[]) => void;
  /** 可用指令卡(输入 / 时触发斜杠命令)。空数组则不触发。 */
  cards?: CardOption[];
  /** 选中斜杠命令时挂载/卸载对应指令卡。 */
  onCardToggle?: (id: string) => void;
  /** 输入框内部、文本区域上方的状态内容。 */
  topContent?: React.ReactNode;
  /** 输入框左侧控制。 */
  leadingControl?: React.ReactNode;
  /** 发送按钮前的右侧控制。 */
  trailingControl?: React.ReactNode;
}

/**
 * 输入框段 —— textarea（粘贴/拖拽/回车）+ 发送/停止按钮 + 斜杠命令。
 * 单行时控件与文字同排，文字换行后输入区向上增高并为底部控件留出空间。
 */
export function ChatInputBox({
  value,
  onChange,
  onSend,
  hasAttachments = false,
  disabled,
  onStop,
  onPasteFiles,
  onDropFiles,
  cards = [],
  onCardToggle,
  topContent,
  leadingControl,
  trailingControl,
}: ChatInputBoxProps) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const canSend = value.trim().length > 0 || hasAttachments;

  // 语音输入:确认句追加到输入框末尾(自动补空格);不支持时主位回退为禁用 send
  const appendTranscript = useCallback((text: string) => {
    onChange(value + (value && !/\s$/.test(value) ? " " : "") + text);
  }, [value, onChange]);
  const speech = useSpeechInput({ locale, onTranscript: appendTranscript });

  // 斜杠命令:输入以 / 开头(单行,无空格隔断)时弹出指令卡列表,模糊匹配 trigger / title
  const slashActive = !disabled && cards.length > 0 && value.startsWith("/") && !value.includes("\n");
  const slashQuery = slashActive ? value.slice(1) : "";
  const slashMatches = useMemo(() => {
    if (!slashActive) return [];
    const q = slashQuery.toLowerCase();
    return cards
      .filter((c) => !q || c.trigger.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      .slice(0, 6);
  }, [slashActive, slashQuery, cards]);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 全局快捷键:输入类控件外按 / 聚焦输入框(再按 / 即可触发斜杠命令)。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      event.preventDefault();
      textareaRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // 用单行态的实际可用宽度测量换行，避免控件下沉后宽度变大导致布局反复切换。
  const collapsedMeasureRef = useRef<HTMLDivElement>(null);
  const expandedMeasureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ multiline: false, height: 48 });
  useEffect(() => {
    const collapsedMeasure = collapsedMeasureRef.current;
    const expandedMeasure = expandedMeasureRef.current;
    if (!collapsedMeasure || !expandedMeasure) return;

    const syncLayout = () => {
      const multiline = value.includes("\n") || collapsedMeasure.scrollHeight > 24;
      const height = multiline
        ? Math.min(expandedMeasure.scrollHeight + 60, window.innerHeight * 0.33)
        : 48;
      setLayout((current) => {
        if (current.multiline === multiline && current.height === height) return current;
        return { multiline, height };
      });
    };

    syncLayout();
    const resizeObserver = new ResizeObserver(syncLayout);
    resizeObserver.observe(collapsedMeasure);
    resizeObserver.observe(expandedMeasure);
    return () => {
      resizeObserver.disconnect();
    };
  }, [value]);

  // 选中斜杠命令:挂载对应指令卡,并移除输入框开头的 /xxx 词,保留其后正文
  const applySlash = (card: CardOption) => {
    onCardToggle?.(card.id);
    const rest = value.replace(/^\/[^\s]*/, "").trimStart();
    onChange(rest);
  };

  // 主行为位优先级:停止生成 > 停止听写 > 发送 > 语音开始 > 禁用 send(无语音环境兜底)
  let mainButton: React.ReactNode;
  if (disabled) {
    mainButton = (
      <button
        type="button"
        onClick={onStop}
        className="group touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-danger transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-px hover:bg-red-500/10 hover:text-danger-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 active:translate-y-0 active:scale-95 motion-reduce:transition-none motion-reduce:hover:transform-none   "
        title={t("stopGeneration")}
        aria-label={t("stopGeneration")}
      >
        <Square strokeWidth={2.5} className="h-4 w-4 transition-transform duration-200 ease-out group-hover:scale-90 motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
      </button>
    );
  } else if (speech.listening) {
    mainButton = (
      <button
        type="button"
        onClick={speech.stop}
        className="touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-sora-blue/[0.08] text-sora-blue motion-safe:animate-pulse focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        title={t("voiceInputStop")}
        aria-label={t("voiceInputStop")}
      >
        <AudioLines className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  } else if (canSend) {
    mainButton = (
      <button
        type="button"
        onClick={onSend}
        className="ai-trigger group touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-sora-blue transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-px hover:bg-sora-blue/[0.08] hover:text-sora-blue-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue active:translate-y-0 active:scale-95 motion-reduce:transition-none motion-reduce:hover:transform-none "
        title={t("send")}
        aria-label={t("send")}
      >
        <AIArrowUpIcon strokeWidth={2.5} className="h-4 w-4" />
      </button>
    );
  } else if (speech.supported) {
    mainButton = (
      <button
        type="button"
        onClick={speech.start}
        className="ai-trigger touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-neutral-600 transition-colors duration-200 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue motion-reduce:transition-none "
        title={t("voiceInputStart")}
        aria-label={t("voiceInputStart")}
      >
        <AudioLines className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  } else {
    mainButton = (
      <button
        type="button"
        aria-disabled="true"
        className="touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full bg-transparent text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue "
        title={t("send")}
        aria-label={t("send")}
      >
        <AIArrowUpIcon strokeWidth={2.5} className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      className="relative rounded-2xl border border-morning-mist bg-white transition-[border-color] duration-200 ease-out focus-within:border-sora-blue motion-reduce:transition-none   "
    >
      {/* 斜杠命令 popover:贴整个输入框上方,避免覆盖附件。 */}
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 z-40 w-72 max-h-60 overflow-y-auto rounded-lg border border-morning-mist  bg-white  py-1 shadow-md">
          {slashMatches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => applySlash(c)}
              onMouseEnter={() => setSlashIndex(i)}
              className={clsx(
                "flex items-center gap-2 w-full text-left px-3 py-1.5 text-ui-caption transition-colors cursor-pointer",
                i === slashIndex
                  ? "bg-sora-blue/[0.06] text-sora-blue"
                  : "text-neutral-600  hover:bg-neutral-50 ",
              )}
            >
              <span className="font-mono font-semibold shrink-0">/{c.trigger}</span>
              <span className="truncate text-neutral-500 ">{c.title}</span>
            </button>
          ))}
        </div>
      )}

      {topContent}

      <div
        className="relative"
        style={{ height: `${layout.height}px` }}
      >
        <div
          ref={collapsedMeasureRef}
          className="pointer-events-none invisible absolute left-12 right-40 top-0 whitespace-pre-wrap break-words text-ui-reading leading-6 sm:right-72"
          aria-hidden="true"
        >
          {`${value || " "}\u200b`}
        </div>
        <div
          ref={expandedMeasureRef}
          className="pointer-events-none invisible absolute left-3 right-3 top-0 whitespace-pre-wrap break-words text-ui-reading leading-6"
          aria-hidden="true"
        >
          {`${value || " "}\u200b`}
        </div>
        <div className="relative h-full min-w-0">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSlashIndex(0);
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            // 收集粘贴进来的文件项:接受任意非纯文本文件
            // (排除 text/* 等纯文本,避免复制普通文本时误触发上传)
            const files: File[] = [];
            for (const item of items) {
              if (item.kind !== "file") continue;
              const f = item.getAsFile();
              if (!f) continue;
              if (f.type.startsWith("text/")) continue;
              files.push(f);
            }
            if (files.length > 0) {
              e.preventDefault();
              onPasteFiles(files);
            }
          }}
          onDrop={(e) => {
            const dropped = e.dataTransfer?.files;
            if (dropped && dropped.length > 0) {
              e.preventDefault();
              onDropFiles(Array.from(dropped));
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            // 斜杠命令激活时拦截导航键,Enter 选中而非发送
            if (slashMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                applySlash(slashMatches[slashIndex]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                // 去掉开头的 /,关闭斜杠菜单
                onChange(value.replace(/^\//, ""));
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={t("placeholder")}
          rows={1}
          className={clsx(
            "scrollbar-hidden block h-full w-full resize-none overflow-y-auto border-0 bg-transparent py-3 text-ui-reading leading-6 text-neutral-800 outline-none placeholder-ink-tertiary focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
            layout.multiline ? "px-3 pb-12" : "pl-12 pr-40 sm:pr-72",
          )}
          aria-label={t("composerInputLabel")}
        />
        </div>

        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex h-8 items-center gap-1.5">
          {leadingControl}
          <div className="flex-1" />
          {trailingControl}
          {mainButton}
        </div>
      </div>
    </div>
  );
}
