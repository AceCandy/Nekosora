"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { clsx } from "clsx";
import type { CardOption } from "@/features/chat/model/types";

interface ChatInputBoxProps {
  value: string;
  onChange: (v: string) => void;
  /** 发送（Enter 或点击发送按钮）。 */
  onSend: () => void;
  /** 流式中禁用输入，且显示停止按钮。 */
  disabled: boolean;
  /** 停止生成。 */
  onStop: () => void;
  /** 粘贴图片文件时触发（传入图片 File 数组）。 */
  onPasteFiles: (files: File[]) => void;
  /** 拖拽文件时触发。 */
  onDropFiles: (files: File[]) => void;
  /** 当前输入文本 + 附件的 token 估算（图片按固定 255 计）。 */
  tokenCount?: number;
  /** 当前模型上下文上限；提供后超 90% 阈值时计数变色警示。 */
  tokenLimit?: number;
  /** 可用指令卡(输入 / 时触发斜杠命令)。空数组则不触发。 */
  cards?: CardOption[];
  /** 选中斜杠命令时挂载/卸载对应指令卡。 */
  onCardToggle?: (id: string) => void;
}

/**
 * 输入框段 —— textarea（粘贴/拖拽/回车）+ 发送/停止按钮 + token 计数 + 斜杠命令。
 * 纯受控：value 与 disabled 由父组件持有；tokenCount 由父组件估算后传入。
 */
export function ChatInputBox({
  value,
  onChange,
  onSend,
  disabled,
  onStop,
  onPasteFiles,
  onDropFiles,
  tokenCount,
  tokenLimit,
  cards = [],
  onCardToggle,
}: ChatInputBoxProps) {
  const t = useTranslations("chat");
  const showCount = typeof tokenCount === "number" && tokenCount > 0;
  const overBudget =
    typeof tokenLimit === "number" &&
    tokenLimit > 0 &&
    typeof tokenCount === "number" &&
    tokenCount > tokenLimit * 0.9;

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

  // textarea 自适应高度:随输入行数增高,最高约视口 1/3,超出则内部滚动
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // 选中斜杠命令:挂载对应指令卡,并移除输入框开头的 /xxx 词,保留其后正文
  const applySlash = (card: CardOption) => {
    onCardToggle?.(card.id);
    const rest = value.replace(/^\/[^\s]*/, "").trimStart();
    onChange(rest);
  };

  return (
    <div className="flex gap-3 items-end bg-white dark:bg-space-ink border border-morning-mist dark:border-deep-space rounded-lg p-2.5 focus-within:border-sora-blue dark:focus-within:border-sora-blue transition-all duration-150">
      <div className="relative flex-1 min-w-0">
        {/* 斜杠命令 popover:贴 textarea 上方,键盘 + 鼠标均可选 */}
        {slashMatches.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 z-40 w-72 max-h-60 overflow-y-auto rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink py-1 shadow-md">
            {slashMatches.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => applySlash(c)}
                onMouseEnter={() => setSlashIndex(i)}
                className={clsx(
                  "flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer",
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
              onSend();
            }
          }}
          placeholder={t("placeholder")}
          rows={1}
          className="w-full bg-transparent border-0 outline-none text-sm resize-none focus:ring-0 text-neutral-800 dark:text-neutral-200 py-1.5 px-2.5 pr-16 leading-relaxed placeholder-neutral-400 max-h-[33dvh] overflow-y-auto"
          disabled={disabled}
          aria-label="对话输入框"
        />
        {showCount && (
          <span
            className={clsx(
              "pointer-events-none absolute bottom-1.5 right-2 text-[10px] font-mono tabular-nums select-none",
              overBudget
                ? "text-orange-500 dark:text-orange-400"
                : "text-neutral-400 dark:text-neutral-600",
            )}
            aria-hidden="true"
          >
            {t("inputTokens", { count: tokenCount })}
          </span>
        )}
      </div>

      {disabled ? (
        <button
          onClick={onStop}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white hover:shadow-[0_4px_12px_rgba(239,68,68,0.15)] transition-all duration-200 shrink-0 shadow-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          title={t("stopGeneration")}
          aria-label={t("stopGeneration")}
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={!value.trim()}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-sora-blue hover:bg-sora-blue-hover text-white hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] disabled:opacity-40 disabled:hover:shadow-none transition-all duration-200 shrink-0 shadow-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
          title={t("send")}
          aria-label={t("send")}
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
