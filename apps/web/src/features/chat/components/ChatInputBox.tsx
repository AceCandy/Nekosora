"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, AudioLines, Square } from "lucide-react";
import { clsx } from "clsx";
import type { CardOption } from "@/features/chat/model/types";

interface ChatInputBoxProps {
  value: string;
  onChange: (v: string) => void;
  /** 发送（Enter 或点击发送按钮）。 */
  onSend: () => void;
  /** 存在附件时允许空文本发送。 */
  hasAttachments?: boolean;
  /** 流式中禁用输入，且显示停止按钮。 */
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
  const canSend = value.trim().length > 0 || hasAttachments;

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

  return (
    <div
      className="relative rounded-2xl border border-morning-mist bg-white shadow-sm transition-[border-color] duration-200 ease-out focus-within:border-sora-blue motion-reduce:transition-none dark:border-deep-space dark:bg-space-ink dark:focus-within:border-sora-blue"
    >
      {/* 斜杠命令 popover:贴整个输入框上方,避免覆盖附件。 */}
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 z-40 w-72 max-h-60 overflow-y-auto rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink py-1 shadow-md">
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
                  : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
              )}
            >
              <span className="font-mono font-semibold shrink-0">/{c.trigger}</span>
              <span className="truncate text-neutral-500 dark:text-neutral-400">{c.title}</span>
            </button>
          ))}
        </div>
      )}

      {topContent}

      <div
        className="relative transition-[height] duration-200 ease-out motion-reduce:transition-none"
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
            "scrollbar-hidden block h-full w-full resize-none overflow-y-auto border-0 bg-transparent py-3 text-ui-reading leading-6 text-neutral-800 outline-none transition-[padding] duration-200 ease-out placeholder-neutral-400 focus:ring-0 focus-visible:outline-none focus-visible:ring-0 motion-reduce:transition-none dark:text-neutral-200",
            layout.multiline ? "px-3 pb-12" : "pl-12 pr-40 sm:pr-72",
          )}
          disabled={disabled}
          aria-label="对话输入框"
        />
        </div>

        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex h-8 items-center gap-1.5">
          {leadingControl}
          <div className="flex-1" />
          {trailingControl}
          {disabled ? (
            <button
              type="button"
              onClick={onStop}
              className="group touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-red-500 transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-px hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 active:translate-y-0 active:scale-95 motion-reduce:transition-none motion-reduce:hover:transform-none dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-300"
              title={t("stopGeneration")}
              aria-label={t("stopGeneration")}
            >
              <Square strokeWidth={2.5} className="h-4 w-4 transition-transform duration-200 ease-out group-hover:scale-90 motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={canSend ? onSend : undefined}
              aria-disabled={!canSend}
              className={clsx(
                "group touch-target pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent transition-[background-color,color,transform] duration-200 ease-out hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue active:translate-y-0 active:scale-95 motion-reduce:transition-none motion-reduce:hover:transform-none",
                canSend
                  ? "cursor-pointer text-sora-blue hover:bg-sora-blue/[0.08] hover:text-sora-blue-hover dark:hover:bg-sora-blue/[0.12]"
                  : "cursor-default text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
              )}
              title={canSend ? t("send") : t("voicePlaceholder")}
              aria-label={canSend ? t("send") : t("voicePlaceholder")}
            >
              {canSend ? (
                <ArrowUp strokeWidth={2.5} className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-y-px motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
              ) : (
                <AudioLines className="h-4 w-4 transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
