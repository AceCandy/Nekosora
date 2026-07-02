"use client";

import { useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { ChatMessage } from "@/features/chat/model/types";

/** 一轮对话:user 消息及其在扁平列表中的下标。 */
interface OutlineTurn {
  /** 该轮 user 消息在扁平 messages 数组中的下标,用作跳转 DOM 锚点 msg-{index}。 */
  userIndex: number;
  /** 用户原话,用于预览。 */
  preview: string;
}

/**
 * 把扁平消息配对成「轮」。每条 user 消息开启新的一轮。
 */
function buildTurns(messages: ChatMessage[]): OutlineTurn[] {
  const turns: OutlineTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    turns.push({ userIndex: i, preview: messages[i].content.trim() });
  }
  return turns;
}

interface ChatOutlineProps {
  messages: ChatMessage[];
  /** 是否正在流式生成(用于高亮最后一轮)。 */
  streaming: boolean;
}

/**
 * 对话大纲:贴滚动区右边缘(滚动条左侧)的一列短横线,排布密集。
 * 鼠标 hover 到整列区域即弹出完整轮次列表(每项显示用户原话),点击列表项跳转到对应消息。
 */
export function ChatOutline({ messages, streaming }: ChatOutlineProps) {
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (turns.length === 0) return null;

  const handleJump = (userIndex: number) => {
    const el = document.getElementById(`msg-${userIndex}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHovered(false);
  };

  const onEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(true);
  };
  const onLeave = () => {
    // 延迟收起,给鼠标从横线移到浮层留出过渡时间
    closeTimer.current = setTimeout(() => setHovered(false), 150);
  };

  return (
    // 触发容器只占横条列尺寸、垂直居中于消息区,hover 仅在此区域生效,
    // 不再撑满整列高度(避免横条上下方空白处误触浮层)
    <div
      className="absolute top-1/2 right-0 -translate-y-1/2 z-10 flex items-center"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* 完整列表浮层:hover 时从横条左侧弹出,显示所有轮次的用户原话 */}
      {hovered && (
        <div className="mr-1 max-h-[60vh] overflow-y-auto w-64 rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink p-2 shadow-lg">
          <ul className="space-y-0.5">
            {turns.map((turn, i) => (
              <li key={turn.userIndex}>
                <button
                  type="button"
                  onClick={() => handleJump(turn.userIndex)}
                  className="w-full text-left rounded-md px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-sora-blue/[0.06] dark:hover:bg-sora-blue/[0.08] transition-colors line-clamp-2"
                >
                  <span className="text-neutral-400 dark:text-neutral-500 mr-1.5 tabular-nums">{i + 1}.</span>
                  {turn.preview || "(空消息)"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 横线列:离右边缘留白,避免与滚动条贴合 */}
      <nav
        className="flex flex-col items-end gap-[5px] w-10 pr-4 cursor-pointer"
        aria-label="对话大纲"
      >
        {turns.map((turn, i) => {
          const isLast = i === turns.length - 1;
          const isGenerating = isLast && streaming;
          return (
            <span
              key={turn.userIndex}
              className={clsx(
                "block h-[3px] rounded-full transition-all duration-200",
                isGenerating
                  ? "w-6 bg-sora-blue"
                  : hovered
                    ? "w-6 bg-sora-blue/60"
                    : "w-5 bg-neutral-300 dark:bg-neutral-600",
              )}
            />
          );
        })}
      </nav>
    </div>
  );
}
