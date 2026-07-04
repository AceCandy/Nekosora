"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { clsx } from "clsx";

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
}

/**
 * 输入框段 —— textarea（粘贴/拖拽/回车）+ 发送/停止按钮 + token 实时计数。
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
}: ChatInputBoxProps) {
  const t = useTranslations("chat");
  const showCount = typeof tokenCount === "number" && tokenCount > 0;
  const overBudget =
    typeof tokenLimit === "number" &&
    tokenLimit > 0 &&
    typeof tokenCount === "number" &&
    tokenCount > tokenLimit * 0.9;

  return (
    <div className="flex gap-3 items-end bg-white dark:bg-space-ink border border-morning-mist dark:border-deep-space rounded-lg p-2.5 focus-within:border-sora-blue dark:focus-within:border-sora-blue transition-all duration-150">
      <div className="relative flex-1 min-w-0">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={t("placeholder")}
          rows={2}
          className="w-full bg-transparent border-0 outline-none text-sm resize-none focus:ring-0 text-neutral-800 dark:text-neutral-200 py-1.5 px-2.5 pr-16 leading-relaxed placeholder-neutral-400"
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
