"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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

/** 当前锚定回答内的标题。 */
interface ResponseHeading {
  el: HTMLElement;
  text: string;
  /** h1=1 / h2=2 / h3=3，用于目录缩进。 */
  level: number;
}

/** 短回答不显示回答目录，避免增加视觉噪音。 */
const MIN_RESPONSE_HEADINGS = 2;
const MIN_RESPONSE_HEIGHT_PX = 360;
const RESPONSE_GUIDE_RATIO = 0.28;

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
  const t = useTranslations("chat");
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const { currentAnchorId } = useMessageScrollerVisibility();
  const { scrollToMessage } = useMessageScroller();
  // 完整列表是否展开:桌面 hover 或 手机 scrub 期间
  const [open, setOpen] = useState(false);
  const [responseHeadings, setResponseHeadings] = useState<ResponseHeading[]>([]);
  const [activeHeadingIdx, setActiveHeadingIdx] = useState(0);
  // 手机 scrub 高亮的轮次索引,null=未拖动;ref 同步供 touchend 即时读取(state 异步可能未提交)
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const scrubIdxRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 圆点右缘到视口右侧放不下面板(16rem+页边距)时,桌面也改为向左弹出(同手机的覆盖式)。
  const [flipLeft, setFlipLeft] = useState(false);
  // 移动端首次出现圆点列时做一次 pulse 轻提示(per-session 一次),暗示这是一组可交互导航
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (sessionStorage.getItem("chat-outline-hinted")) return;
    sessionStorage.setItem("chat-outline-hinted", "1");
    // 挪到下一拍:setState 不允许在 effect 体内同步调用;pulse 展示 2.4s 后关闭
    const on = setTimeout(() => setShowHint(true), 50);
    const off = setTimeout(() => setShowHint(false), 2450);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, []);

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

  const responseIndex =
    anchorIndex >= 0 && messages[anchorIndex + 1]?.role === "assistant"
      ? anchorIndex + 1
      : -1;

  // 当前回答在流式期间会持续增高，ResizeObserver 跟随重测标题位置。
  useEffect(() => {
    const el = responseIndex >= 0 ? document.getElementById(`msg-${responseIndex}`) : null;
    const measure = () => {
      const rect = el?.getBoundingClientRect();
      const nodes = el ? Array.from(el.querySelectorAll<HTMLElement>("h1, h2, h3")) : [];
      if (!rect || nodes.length < MIN_RESPONSE_HEADINGS || rect.height < MIN_RESPONSE_HEIGHT_PX) {
        setResponseHeadings([]);
        return;
      }
      setResponseHeadings(
        nodes.map((node) => ({
          el: node,
          text: (node.textContent ?? "").trim(),
          level: Number(node.tagName[1]) || 1,
        })),
      );
    };
    const raf = requestAnimationFrame(measure);
    if (!el || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(raf);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [responseIndex, messages]);

  // 取阅读视口顶部往下 28% 引导线上方的最后一个标题。
  useEffect(() => {
    if (responseIndex < 0 || responseHeadings.length === 0) return;
    const el = document.getElementById(`msg-${responseIndex}`);
    const scroller = el?.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const guide =
        scroller.getBoundingClientRect().top + scroller.clientHeight * RESPONSE_GUIDE_RATIO;
      let idx = 0;
      for (let i = 0; i < responseHeadings.length; i++) {
        if (responseHeadings[i].el.getBoundingClientRect().top <= guide) idx = i;
        else break;
      }
      setActiveHeadingIdx(idx);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [responseIndex, responseHeadings]);

  if (turns.length <= 2 && responseHeadings.length === 0) return null;

  const handleJump = (userIndex: number) => {
    scrollToMessage(`msg-${userIndex}`, { behavior: "smooth" });
  };

  const handleHeadingJump = (index: number) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    responseHeadings[index].el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
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
      onFocusCapture={onEnter}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave();
      }}
    >
      {/* 完整轮次列表:桌面 hover 或 手机 scrub 时展开;手机拖动时列表项高亮跟随 scrubIdx */}
      {open && (
        <div className={clsx(
          "mr-1 max-h-[60vh] w-64 max-w-[80vw] rounded-lg border border-morning-mist bg-white p-2 shadow-lg",
          responseHeadings.length > 0 ? "overflow-hidden" : "overflow-y-auto",
          flipLeft
            ? "lg:order-1 lg:absolute lg:right-full lg:top-1/2 lg:mr-1 lg:w-64 lg:max-w-none lg:-translate-y-1/2"
            : "lg:order-2 lg:ml-1 lg:mr-0 lg:min-w-0 lg:flex-1 lg:w-auto lg:max-w-none",
        )}>
          <div className={responseHeadings.length > 0 ? "max-h-[28vh] overflow-y-auto" : undefined}>
            {responseHeadings.length > 0 && (
              <p className="px-2 py-1 text-ui-caption font-medium text-ink-tertiary">
                {t("outlineConversation")}
              </p>
            )}
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
          {responseHeadings.length > 0 && (
            <div className="mt-2 max-h-[20vh] overflow-y-auto border-t border-morning-mist pt-2">
              <p className="px-2 py-1 text-ui-caption font-medium text-ink-tertiary">
                {t("outlineCurrentResponse")}
              </p>
              <ul className="space-y-0.5">
                {responseHeadings.map((heading, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => handleHeadingJump(i)}
                      aria-current={i === activeHeadingIdx ? "location" : undefined}
                      className={clsx(
                        "w-full truncate whitespace-nowrap rounded-md px-2 py-1.5 text-left text-ui-caption transition-colors",
                        i === activeHeadingIdx
                          ? "bg-sora-blue/[0.10] font-medium text-neutral-800"
                          : "text-neutral-600 hover:bg-sora-blue/[0.06]",
                      )}
                      style={{ paddingLeft: `${0.5 + (heading.level - 1) * 0.75}rem` }}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 点状大纲:生成中/拖动/当前轮高亮,桌面 hover 弱高亮;圆点是可聚焦按钮,键盘 Tab 进入即展开列表 */}
      <nav
        ref={navRef}
        className={clsx(
          "group/nav flex w-6 cursor-pointer touch-none flex-col items-end gap-[5px] pr-2 lg:order-1",
          showHint && "motion-safe:animate-pulse",
        )}
        aria-label={t("conversationOutline")}
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
            <button
              key={turn.userIndex}
              type="button"
              onClick={() => handleJump(turn.userIndex)}
              aria-label={t("outlineGoToTurn", { index: i + 1 })}
              aria-current={isActive ? "true" : undefined}
              className={clsx(
                // after 伪元素把 6px 圆点的命中面扩到约 22×12px;hover/focus-within 整列轻微放大作"可交互"预暗示
                "relative block rounded-full border-0 p-0 transition-[width,height,background-color,opacity,transform] duration-150 after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-[''] group-hover/nav:scale-110 group-focus-within/nav:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
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
