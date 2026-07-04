"use client";

import React, { type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, ChevronDown } from "lucide-react";
import { ChatMessageItem } from "@/features/chat/components/ChatMessageItem";
import { ChatOutline } from "@/features/chat/components/ChatOutline";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import type { ChatMessage, ModelOption } from "@/features/chat/model/types";
import type { Artifact } from "@/features/artifacts/ArtifactPanel";

interface ChatMessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  /** 滚动容器 ref（由 useChatScrollController 提供）。 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 底部锚点 ref（流式时撑高 h-32 作为缓冲与滚动锚）。 */
  messagesEndRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  onScroll: () => void;
  scrollToBottom: () => void;
  /** 当前模型名（传给 ChatMessageItem 供 regenerate/edit 使用）。 */
  model: string;
  /** 当前会话选用的输出样式 cssClass（null=默认渲染）。 */
  renderStyleClass?: string | null;
  renderStyleRenderer?: "streamdown" | "custom";
  onRegenerate: (publicId: string, model: string) => void;
  onEdit?: (publicId: string, newContent: string, model: string) => void;
  onSwitchVersion?: (publicId: string, direction: "prev" | "next") => void;
  onOpenArtifact: (a: Artifact) => void;
  /** 软删除一条消息。 */
  onDelete?: (publicId: string) => void;
  /** 在 assistant 消息末尾续写。 */
  onContinue?: (publicId: string) => void;
  /** 可用模型列表(传给 ChatMessageItem 供重新生成换模型)。 */
  models?: ModelOption[];
  /** 空状态点击示例问题：填入输入框供用户编辑后发送。 */
  onPickSample?: (text: string) => void;
}

/**
 * 消息列表段 —— 滚动容器 + 空状态 + 消息渲染 + 对话大纲 + 回到底部按钮。
 *
 * 从 ChatComposer 抽出，纯展示：所有状态由父组件（ChatComposer）受控下传。
 * 消息数组语义为「只追加 / 原地替换 / 末尾截断」，故 index 作为 key 在此场景功能正确
 * （publicId 延迟回填，改用 publicId 需 fallback 且无额外收益）。
 * 每条 ChatMessageItem 外包 ErrorBoundary，单条渲染崩溃不影响兄弟消息。
 */
export function ChatMessageList({
  messages,
  streaming,
  scrollRef,
  messagesEndRef,
  isAtBottom,
  onScroll,
  scrollToBottom,
  model,
  renderStyleClass,
  renderStyleRenderer,
  onRegenerate,
  onEdit,
  onSwitchVersion,
  onOpenArtifact,
  onDelete,
  onContinue,
  models,
  onPickSample,
}: ChatMessageListProps) {
  const t = useTranslations("chat");
  const rawSamples = t.raw("sampleQuestions");
  const samples: string[] = Array.isArray(rawSamples)
    ? rawSamples.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : [];

  return (
    // 相对外层 relative 容器,让对话大纲/回到最新按钮锚定在消息区(而非含输入框的主区)
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-6 py-8 md:py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {messages.length === 0 && (
            <WelcomeBlock samples={samples} onPickSample={onPickSample} />
          )}

          {messages.map((m, i) => (
            <ErrorBoundary key={i} name="message">
              <ChatMessageItem
                domId={`msg-${i}`}
                message={m}
                isLast={i === messages.length - 1}
                isStreaming={streaming}
                model={model}
                renderStyleClass={renderStyleClass}
                renderStyleRenderer={renderStyleRenderer}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
                onSwitchVersion={onSwitchVersion}
                onOpenArtifact={onOpenArtifact}
                onDelete={onDelete}
                onContinue={onContinue}
                models={models}
              />
            </ErrorBoundary>
          ))}
          {/* 底部留白缓冲:仅在流式生成时留白,让生成中的内容停在视口中部偏上;同时作为滚动锚点 */}
          <div ref={messagesEndRef} className={streaming ? "h-32" : "h-0"} />
        </div>
      </div>

      {/* 对话大纲:贴消息区右边缘(滚动条左侧),hover 整列弹出完整轮次列表 */}
      <ChatOutline messages={messages} streaming={streaming} />

      {/* 跳到最新:用户上滑离开底部时浮出,贴消息区底部内侧,点击回到底部并恢复跟随 */}
      {!isAtBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors duration-150"
          title={t("scrollToLatest")}
          aria-label={t("scrollToLatest")}
        >
          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t("scrollToLatest")}</span>
        </button>
      )}
    </div>
  );
}

/** 空会话欢迎屏：引导文案 + 可点击示例问题（点击填入输入框）。 */
function WelcomeBlock({
  samples,
  onPickSample,
}: {
  samples: string[];
  onPickSample?: (text: string) => void;
}) {
  const t = useTranslations("chat");
  return (
    <div className="text-center py-24 md:py-32 space-y-6 animate-in fade-in duration-300">
      <div className="w-12 h-12 rounded-full bg-sora-blue/[0.04] dark:bg-sora-blue/[0.02] border border-sora-blue/20 flex items-center justify-center mx-auto">
        <Sparkles className="w-5 h-5 text-sora-blue" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-bold text-neutral-800 dark:text-white">{t("welcomeTitle")}</h2>
        <p className="text-xs text-neutral-450 dark:text-neutral-500 max-w-[280px] mx-auto leading-relaxed">
          {t("welcomeDesc")}
        </p>
      </div>
      {samples.length > 0 && (
        <div className="max-w-xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
          {samples.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickSample?.(q)}
              className="rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3.5 py-2.5 text-xs text-neutral-600 dark:text-neutral-300 hover:border-sora-blue dark:hover:border-sora-blue hover:text-neutral-900 dark:hover:text-white hover:shadow-sm transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
