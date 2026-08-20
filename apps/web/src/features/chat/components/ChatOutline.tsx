"use client";

import { useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useMessageScroller, useMessageScrollerVisibility } from "@shadcn/react/message-scroller";
import type { ChatMessage } from "@/features/chat/model/types";

/** 一轮对话:user 消息及其在扁平列表中的下标。 */
interface OutlineTurn {
  /** 该轮 user 消息在扁平 messages 数组中的下标,供 scrollToMessage 跳转。 */
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
 * 对话大纲:贴聊天正文右缘的一列圆点。
 * 桌面 hover / 手机在圆点上按下 均展开完整轮次列表:
 *   - 桌面:鼠标移到列表项点击跳转;
 *   - 手机:在圆点上上下滑动(scrub),列表内对应项高亮跟随,放手跳到停下的轮。
 * 手机 scrub 由 touch-action:none 接管手势(不滚页面),touchend 立即收起列表并跳转。
 *
 * 高亮当前轮 / 跳转由 message-scroller 原语承载:本组件须渲染在 MessageScroller.Provider 内。
 */
export function ChatOutline({ messages, streaming }: ChatOutlineProps) {
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const { currentAnchorId } = useMessageScrollerVisibility();
  const { scrollToMessage } = useMessageScroller();
  // 完整列表是否展开:桌面 hover 或 手机 scrub 期间
  const [open, setOpen] = useState(false);
  // 手机 scrub 高亮的轮次索引,null=未拖动;ref 同步供 touchend 即时读取(state 异步可能未提交)
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const scrubIdxRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 圆点右缘到视口右侧放不下面板(16rem+页边距)时,桌面也改为向左弹出(同手机的覆盖式)。
  const [flipLeft, setFlipLeft] = useState(false);

  // currentAnchorId 形如 "msg-N":解析出 msg index,用于高亮当前所在轮次
  const anchorIndex = (() => {
    if (!currentAnchorId?.startsWith("msg-")) return -1;
    const n = Number(currentAnchorId.slice(4));
    return Number.isFinite(n) ? n : -1;
  })();

  // 当前锚定 msg 落在哪一轮(向后找最近的 user 消息轮次),-1 表示无定位
  const activeTurnIdx = useMemo(() => {
    if (anchorIndex < 0 || turns.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].userIndex <= anchorIndex) idx = i;
      else break;
    }
    return idx;
  }, [turns, anchorIndex]);

  if (turns.length <= 2) return null;

  const handleJump = (userIndex: number) => {
    scrollToMessage(`msg-${userIndex}`, { behavior: "smooth" });
  };

  const decideFlip = () => {
    const nav = navRef.current;
    if (!nav) return;
    setFlipLeft(window.innerWidth - nav.getBoundingClientRect().right < 280);
  };

  const onEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    decideFlip();
    setOpen(true);
  };
  const onLeave = () => {
    // 延迟收起,给鼠标从圆点移到浮层留出过渡时间
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  // 据触摸 Y 映射到轮次索引:nav 高度均分到各轮
  const computeIdx = (clientY: number) => {
    const nav = navRef.current;
    if (!nav || turns.length === 0) return 0;
    const rect = nav.getBoundingClientRect();
    if (rect.height === 0) return 0;
    const ratio = (clientY - rect.top) / rect.height;
    return Math.max(0, Math.min(turns.length - 1, Math.round(ratio * (turns.length - 1))));
  };
  const updateScrub = (i: number) => {
    scrubIdxRef.current = i;
    setScrubIdx(i);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    updateScrub(computeIdx(e.touches[0].clientY));
  };
  const onTouchMove = (e: React.TouchEvent) => updateScrub(computeIdx(e.touches[0].clientY));
  const onTouchEnd = () => {
    const i = scrubIdxRef.current;
    if (i !== null) scrollToMessage(`msg-${turns[i].userIndex}`, { behavior: "smooth" });
    scrubIdxRef.current = null;
    setScrubIdx(null);
    setOpen(false);
  };

  return (
    // 桌面将入口锚定在正文最大宽度右缘,面板向右填满剩余空间;右侧空间不足(窗口过窄)
    // 时 decideFlip 把面板改为向左弹出;手机保留紧凑浮层。
    <div
      className="absolute top-1/2 right-0 z-10 flex -translate-y-1/2 items-center lg:left-[calc(50%_+_24rem)] lg:right-3"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* 完整轮次列表:桌面 hover 或 手机 scrub 时展开;手机拖动时列表项高亮跟随 scrubIdx */}
      {open && (
        <div className={clsx(
          "mr-1 max-h-[60vh] w-64 max-w-[80vw] overflow-y-auto rounded-lg border border-morning-mist bg-white p-2 shadow-lg",
          flipLeft
            ? "lg:order-1 lg:absolute lg:right-full lg:top-1/2 lg:mr-1 lg:w-64 lg:max-w-none lg:-translate-y-1/2"
            : "lg:order-2 lg:ml-1 lg:mr-0 lg:min-w-0 lg:flex-1 lg:w-auto lg:max-w-none",
        )}>
          <ul className="space-y-0.5">
            {turns.map((turn, i) => (
              <li key={turn.userIndex}>
                <button
                  type="button"
                  onClick={() => handleJump(turn.userIndex)}
                  className={clsx(
                    "w-full truncate whitespace-nowrap rounded-md px-2 py-1.5 text-left text-ui-caption transition-colors",
                    i === scrubIdx
                      ? "bg-sora-blue/20 text-neutral-800  font-medium"
                      : i === activeTurnIdx
                        ? "bg-sora-blue/[0.10] text-neutral-800  font-medium"
                        : "text-neutral-600  hover:bg-sora-blue/[0.06] ",
                  )}
                >
                  <span className="text-neutral-400  mr-1.5 tabular-nums">{i + 1}.</span>
                  {turn.preview || "(空消息)"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 点状大纲:生成中/拖动/当前轮高亮,桌面 hover 弱高亮 */}
      <nav
        ref={navRef}
        className="flex w-6 cursor-pointer touch-none flex-col items-end gap-[5px] pr-2 lg:order-1"
        aria-label="对话大纲"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {turns.map((turn, i) => {
          const isLast = i === turns.length - 1;
          const isGenerating = isLast && streaming;
          const isActive = i === activeTurnIdx;
          const isScrub = scrubIdx === i;
          return (
            <span
              key={turn.userIndex}
              className={clsx(
                "block rounded-full transition-[width,height,background-color,opacity,transform] duration-150",
                isGenerating
                  ? "w-2 h-2 bg-sora-blue animate-pulse"
                  : isScrub || isActive
                    ? "w-2 h-2 bg-sora-blue"
                    : open
                      ? "w-1.5 h-1.5 bg-sora-blue/50"
                      : "w-1.5 h-1.5 bg-neutral-300 ",
              )}
            />
          );
        })}
      </nav>
    </div>
  );
}
