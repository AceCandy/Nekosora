"use client";

import React, { type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, ChevronDown } from "lucide-react";
import { ChatMessageItem } from "@/features/chat/components/ChatMessageItem";
import { ChatOutline } from "@/features/chat/components/ChatOutline";
import type { ChatMessage } from "@/features/chat/model/types";
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
}

/**
 * 消息列表段 —— 滚动容器 + 空状态 + 消息渲染 + 对话大纲 + 回到底部按钮。
 *
 * 从 ChatComposer 抽出，纯展示：所有状态由父组件（ChatComposer）受控下传。
 * 消息数组语义为「只追加 / 原地替换 / 末尾截断」，故 index 作为 key 在此场景功能正确
 * （publicId 延迟回填，改用 publicId 需 fallback 且无额外收益）。
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
}: ChatMessageListProps) {
  const t = useTranslations("chat");

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 py-8 md:py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        {messages.length === 0 && (
          <div className="text-center py-24 md:py-32 space-y-4 animate-in fade-in duration-300">
            <div className="w-12 h-12 rounded-full bg-sora-blue/[0.04] dark:bg-sora-blue/[0.02] border border-sora-blue/20 flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5 text-sora-blue" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-neutral-800 dark:text-white">{t("welcomeTitle")}</h2>
              <p className="text-xs text-neutral-450 dark:text-neutral-500 max-w-[280px] mx-auto leading-relaxed">
                {t("welcomeDesc")}
              </p>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <ChatMessageItem
            key={i}
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
          />
        ))}
        {/* 底部留白缓冲:仅在流式生成时留白,让生成中的内容停在视口中部偏上;同时作为滚动锚点 */}
        <div ref={messagesEndRef} className={streaming ? "h-32" : "h-0"} />
      </div>

      {/* 对话大纲:贴滚动区右边缘(滚动条左侧),hover 整列弹出完整轮次列表 */}
      <ChatOutline messages={messages} streaming={streaming} />

      {/* 跳到最新:用户上滑离开底部时浮出,点击回到底部并恢复跟随 */}
      {!isAtBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors duration-150"
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
