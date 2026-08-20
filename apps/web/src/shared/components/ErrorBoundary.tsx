"use client";

import React, { Component, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** 崩溃来源标签，用于日志定位。 */
  name?: string;
  /** 原始内容，崩溃时折叠展示，便于用户查看或复制。 */
  rawContent?: string;
  /** 自定义 fallback；不传则用默认占位。 */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染级错误边界 —— 防止局部渲染异常拖垮整条消息或整个消息列表。
 *
 * 设计取舍：
 *   - 捕获子树渲染错误后显示占位 + 原始内容折叠，而非整页白屏
 *   - 不在开发环境 rethrow：fallback 内显示 error.message 便于定位，同时保留隔离
 *   - 生产环境仅显示通用提示，避免泄露堆栈
 *
 * 用于 chat 消息的三级隔离：Markdown 渲染 / 单个工具调用卡片 / 整条消息兜底。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      `[ErrorBoundary:${this.props.name ?? "unnamed"}] render crashed`,
      error,
      info.componentStack,
    );
  }

  reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <DefaultFallback
        error={error}
        reset={this.reset}
        raw={this.props.rawContent}
      />
    );
  }
}

interface DefaultFallbackProps {
  error: Error;
  reset: () => void;
  raw?: string;
}

function DefaultFallback({ error, reset, raw }: DefaultFallbackProps) {
  const t = useTranslations("chat");
  const [showRaw, setShowRaw] = useState(false);
  const isDev = process.env.NODE_ENV !== "production";
  const hasRaw = raw !== undefined && raw !== "";

  return (
    <div className="rounded-md border border-red-200  bg-red-50/60  px-3 py-2 text-ui-caption text-danger  animate-in fade-in duration-150">
      <div className="flex items-center gap-1.5">
        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="font-semibold">{t("renderFailed")}</span>
        {isDev && error.message && (
          <span className="opacity-70 truncate">· {error.message}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="underline underline-offset-2 opacity-80 hover:opacity-100 cursor-pointer"
          >
            {t("retry")}
          </button>
          {hasRaw && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="underline underline-offset-2 opacity-80 hover:opacity-100 cursor-pointer"
            >
              {showRaw ? t("hideRaw") : t("showRaw")}
            </button>
          )}
        </div>
      </div>
      {showRaw && hasRaw && (
        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70  p-2 text-neutral-500  font-mono">
          {raw}
        </pre>
      )}
    </div>
  );
}
