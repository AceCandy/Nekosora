"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useMessageScrollerVisibility } from "@shadcn/react/message-scroller";
import type { ChatMessage } from "@/features/chat/model/types";

/** 当前锚定回答内的标题条目,ratio 为标题在回答中的相对位置(0~1),供轨道线定位。 */
interface ResponseHeading {
  el: HTMLElement;
  text: string;
  /** h1=1 / h2=2 / h3=3,决定轨道线宽度与列表缩进。 */
  level: number;
  ratio: number;
}

/** 回答内标题 ≥2 且回答够高才出轨道,短回答不增加视觉噪音。 */
const MIN_HEADINGS = 2;
const MIN_RESPONSE_HEIGHT_PX = 360;
/** 当前标题判定引导线:视口顶部往下 28% 处,与阅读视线落点一致。 */
const GUIDE_RATIO = 0.28;
/** 轨道线宽度按标题层级递减(h1 最宽),与层级权重一致。 */
const MARKER_WIDTH_CLASS = ["w-4", "w-3", "w-2"] as const;

/**
 * 回答内标题大纲轨(借鉴 DEEIX chat-response-outline-rail):
 * 贴消息区右缘(轮次大纲左侧)的一列细横线,把当前锚定 assistant 回答里的 h1-h3
 * 按相对位置投影成轨道;hover 展开完整大纲浮层,点击平滑滚动到对应标题。
 * 桌面限定(lg+),须渲染在 MessageScroller.Provider 内。
 */
export function ChatResponseOutline({ messages }: { messages: ChatMessage[] }) {
  const { currentAnchorId } = useMessageScrollerVisibility();
  const [headings, setHeadings] = useState<ResponseHeading[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 锚定标在 user 消息上(msg-N),其回答即紧随的 assistant 消息 msg-(N+1)
  const anchorIndex = (() => {
    if (!currentAnchorId?.startsWith("msg-")) return -1;
    const n = Number(currentAnchorId.slice(4));
    return Number.isFinite(n) ? n : -1;
  })();
  const responseIndex =
    anchorIndex >= 0 && messages[anchorIndex + 1]?.role === "assistant"
      ? anchorIndex + 1
      : -1;

  // 测量回答内标题:流式期间内容持续增长,ResizeObserver 跟随高度变化重测
  useEffect(() => {
    const el = responseIndex >= 0 ? document.getElementById(`msg-${responseIndex}`) : null;
    const measure = () => {
      const rect = el?.getBoundingClientRect();
      const nodes = el ? Array.from(el.querySelectorAll<HTMLElement>("h1, h2, h3")) : [];
      if (!rect || nodes.length < MIN_HEADINGS || rect.height < MIN_RESPONSE_HEIGHT_PX) {
        setHeadings([]);
        return;
      }
      setHeadings(
        nodes.map((node) => ({
          el: node,
          text: (node.textContent ?? "").trim(),
          level: Number(node.tagName[1]) || 1,
          ratio: (node.getBoundingClientRect().top - rect.top) / rect.height,
        })),
      );
    };
    // 首测排进 rAF:避开 effect 内同步 setState,且等首帧布局稳定后再读 rect
    const raf = requestAnimationFrame(measure);
    if (!el || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(raf);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [responseIndex, messages]);

  // 当前标题:监听滚动容器,取引导线上方最后一个标题;rAF 节流避免滚动期抖动
  useEffect(() => {
    if (responseIndex < 0 || headings.length === 0) return;
    const el = document.getElementById(`msg-${responseIndex}`);
    const scroller = el?.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const guide = scroller.getBoundingClientRect().top + scroller.clientHeight * GUIDE_RATIO;
      let idx = 0;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].el.getBoundingClientRect().top <= guide) idx = i;
        else break;
      }
      setActiveIdx(idx);
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
  }, [responseIndex, headings]);

  if (headings.length === 0) return null;

  const jump = (i: number) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    headings[i].el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  const onEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const onLeave = () => {
    // 延迟收起,给鼠标从轨道移到浮层留出过渡时间(与 ChatOutline 同手法)
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div
      className="absolute top-1/2 right-8 z-10 hidden -translate-y-1/2 items-center lg:flex"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* 完整大纲浮层:hover 轨道展开,menu-pop 入场 */}
      {open && (
        <div className="menu-pop absolute right-full top-1/2 mr-2 max-h-[60vh] w-64 max-w-[80vw] -translate-y-1/2 overflow-y-auto rounded-lg border border-morning-mist bg-white p-2 shadow-lg">
          <ul className="space-y-0.5">
            {headings.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => jump(i)}
                  className={clsx(
                    "w-full truncate whitespace-nowrap rounded-md px-2 py-1.5 text-left text-ui-caption transition-colors",
                    i === activeIdx
                      ? "bg-sora-blue/[0.10] font-medium text-neutral-800"
                      : "text-neutral-600 hover:bg-sora-blue/[0.06]",
                  )}
                  style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.75}rem` }}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 细线轨道:标题按在回答中的相对位置落点,线宽随层级递减 */}
      <nav aria-label="回答大纲" className="relative h-[38vh] w-4 cursor-pointer">
        {headings.map((h, i) => (
          <button
            key={i}
            type="button"
            onClick={() => jump(i)}
            aria-label={h.text}
            className={clsx(
              "absolute right-0 block h-0.5 rounded-full transition-[background-color,opacity] duration-150",
              MARKER_WIDTH_CLASS[Math.min(h.level, 3) - 1],
              i === activeIdx
                ? "bg-sora-blue"
                : open
                  ? "bg-sora-blue/40 hover:bg-sora-blue/70"
                  : "bg-neutral-300 hover:bg-sora-blue/60",
            )}
            style={{ top: `${Math.min(99, Math.max(0, h.ratio * 100))}%` }}
          />
        ))}
      </nav>
    </div>
  );
}
