"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** 距离底部多少像素内仍视为"贴底"(滚回此处即恢复自动跟随)。 */
const BOTTOM_THRESHOLD = 24;
/** 距底部不超过视口高度的此比例时,视为「在最新附近」,回到最新按钮隐藏。 */
const NEAR_BOTTOM_RATIO = 1 / 3;
/** 回到底部动画的固定时长(比原生 smooth 短,手感更跟手)。 */
const SCROLL_DURATION = 280;

/** 自定义缓动到底部:比原生 smooth 更快,避免长距离时拖沓。 */
function smoothScrollToBottom(el: HTMLElement) {
  const from = el.scrollTop;
  const to = el.scrollHeight - el.clientHeight;
  const distance = to - from;
  if (distance <= 0) {
    el.scrollTop = to;
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SCROLL_DURATION);
    // easeOutCubic:起步快、末段平滑收尾
    const eased = 1 - Math.pow(1 - t, 3);
    el.scrollTop = from + distance * eased;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * 聊天滚动控制器(pinned 语义)。
 *
 * 行为:
 * - pinned(默认 true)=「用户想贴底跟随」。生成中内容增长时,每帧把 scrollTop 直接设到
 *   scrollHeight 瞬时贴底(层1 合批让 content 每帧只变一次,视觉上随内容匀速流出而平滑)。
 * - 用户主动上滑(滚轮 / 触摸 / 键盘上方向)且不在底部 → pinned=false,立即停止跟随,不抢滚动。
 * - 用户滚回底部阈值内,或点「回到最新」→ pinned 恢复 true;发新消息走 prompt-pin(pinToMessageTop,见下)。
 *
 * 两套阈值:
 * - BOTTOM_THRESHOLD(窄):pinned 恢复判定——滚回距底 ≤24px 即恢复跟随;仅供内部 ref。
 * - isNearBottom(宽,NEAR_BOTTOM_RATIO × 视口高):对外 state,供「回到最新」按钮显隐——
 *   距底 ≤ 1/3 屏视为在最新附近、按钮隐藏,避免必须几乎贴底按钮才消失。
 *
 * 关键:跟随用 scrollTop=scrollHeight 而非 scrollIntoView——前者基于 DOM 当前真实高度瞬时贴底,
 * 不受虚拟滚动 measureElement 异步延迟影响;后者在长内容下会滚不到位、被误判离开底部而永久停跟随。
 *
 * pinned 只由「用户输入事件」翻转(wheel/touch/key),程序自身设 scrollTop 不会触发这些事件,
 * 故程序贴底跟随不会被误判为「用户离开」。
 */
export function useChatScrollController<T>(messages: T[], streaming: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // pinned:用户是否想贴底跟随(内部 ref,不对外暴露以免无消费者时的冗余重渲染)。
  const pinnedRef = useRef(true);
  // pinning:发消息后「用户消息钉顶」(prompt-pin)阶段;内容未超视口时保持钉顶,超视口后退出转贴底 follow。
  const pinningRef = useRef(false);
  // 上一帧 streaming,用于检测 true→false(流式结束)收尾贴底,跳过首次挂载。
  const prevStreamingRef = useRef(false);
  // 待 pin 的消息 index(发消息后由 pinToMessageTop 设置,跟随 effect 在 DOM 更新后执行 pin,避开 rAF 时序竞态)。
  const pendingPinRef = useRef<number | null>(null);
  // pin 起始 scrollHeight,用于判断回复增长是否超过阈值以退出 pin 转 follow。
  const pinScrollHeightRef = useRef(0);
  // 「在最新附近」(宽阈值):对外 state,供回到最新按钮显隐。
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  /** 挂载贴底收敛后才置 true,供消息区淡入显形(hide-until-settled);会话切换重挂时重置为 false。 */
  const [ready, setReady] = useState(false);

  const measureBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  const measureNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= el.clientHeight * NEAR_BOTTOM_RATIO;
  }, []);

  // 用户主动上滑 → 取消跟随。只由用户输入事件翻转 pinned;程序自身设 scrollTop 不触发这些事件,
  // 故贴底跟随不会被误判为「用户离开」。表单元素聚焦时的方向键忽略(避免打字时误触)。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && !measureBottom()) pinnedRef.current = false;
    };
    let touchStartTop = 0;
    const onTouchStart = () => { touchStartTop = el.scrollTop; };
    const onTouchMove = () => {
      if (el.scrollTop < touchStartTop - 4 && !measureBottom()) pinnedRef.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "PageUp" && e.key !== "Home") return;
      const ae = document.activeElement;
      if (!ae || !el.contains(ae)) return;
      const tag = (ae.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (ae as HTMLElement).isContentEditable) return;
      if (!measureBottom()) pinnedRef.current = false;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("keydown", onKey);
    };
  }, [measureBottom]);

  const handleScroll = useCallback(() => {
    // 滚回底部阈值内 → 自动恢复跟随。
    if (measureBottom()) pinnedRef.current = true;
    // pin 阶段不改 isNearBottom(由跟随 effect 控制,避免 pin 动画期间按钮闪烁)。
    if (pinningRef.current) return;
    const nearBottom = measureNearBottom();
    isNearBottomRef.current = nearBottom;
    setIsNearBottom(nearBottom);
  }, [measureBottom, measureNearBottom]);

  // 每帧(messages 变化=层1 合批每帧一次)处理跟随/pin。用 scrollTop=scrollHeight 瞬时贴底,
  // 内容匀速流出下视觉即平滑,且无 scrollIntoView 的 measure 延迟抖动。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) {
      if (pendingPinRef.current !== null) {
        // 发消息后 pin:把用户消息定位到视口中部偏上(约 18%),下方留白给回复生长(参考 ChatGPT)。
        const idx = pendingPinRef.current;
        pendingPinRef.current = null;
        pinningRef.current = true;
        const target = document.getElementById(`msg-${idx}`);
        if (target) {
          const cTop = el.getBoundingClientRect().top;
          const tTop = target.getBoundingClientRect().top;
          el.scrollBy({ top: tTop - cTop - el.clientHeight * 0.18, behavior: "smooth" });
        }
        pinScrollHeightRef.current = el.scrollHeight;
      } else if (pinningRef.current) {
        // pin 阶段:回复增长超过 ~70% 视口时退出 pin 转贴底 follow,否则保持 pin 位置不动。
        if (el.scrollHeight - pinScrollHeightRef.current > el.clientHeight * 0.7) {
          pinningRef.current = false;
          el.scrollTop = el.scrollHeight;
        }
      } else {
        // follow 阶段:贴底
        el.scrollTop = el.scrollHeight;
      }
    } else if (pendingPinRef.current !== null) {
      pendingPinRef.current = null; // pinned=false(用户上滑)时丢弃待 pin
    }
    // 延迟一帧重算 isNearBottom(pin 阶段强制隐藏「回到最新」按钮,避免动画期间误显)。
    const raf = requestAnimationFrame(() => {
      if (pinningRef.current) {
        isNearBottomRef.current = true;
        setIsNearBottom(true);
      } else {
        const nearBottom = measureNearBottom();
        isNearBottomRef.current = nearBottom;
        setIsNearBottom(nearBottom);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, measureNearBottom]);

  // 流式结束收尾:用户在跟随时贴底,消除 prompt-pin 的偏上留白(参考 ChatGPT 结束贴底);
  // 用户已上滑(pinned=false)则尊重其位置不强制拉回。prevStreaming 只在 true→false 转换时生效,跳过首次挂载(交由 hide-until-settled)。
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!wasStreaming || streaming) return;
    const el = scrollRef.current;
    if (el && pinnedRef.current) {
      pinningRef.current = false;
      smoothScrollToBottom(el);
    }
  }, [streaming]);

  // 历史会话挂载:虚拟滚动 measureElement 的 estimateSize 是粗估,真实高度要在挂载后逐条测出。
  // 若可见状态下贴底,用户会看到「估算底部 → 真实底部」的测量追赶滚动(体感差)。解法
  // hide-until-settled:外层消息区在 ready 前保持 opacity-0,本循环在不可见态持续贴底,直到
  // scrollHeight 连续稳定(测量收敛)再 setReady(true) 触发淡入显形——用户看到的是直接出现
  // 在底部 + 淡入,无任何滚动动作。pinned 初始即为 true(消息 effect 只读不翻),故此处无条件贴底。
  // 仅组件挂载时跑一次;会话切换令组件重挂重跑(ready 重置为 false,重新隐藏→稳定→显形)。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    let lastH = -1;
    let stable = 0;
    let start = 0;
    let deadline = 0;
    const finish = () => {
      pinnedRef.current = true;
      isNearBottomRef.current = true;
      setIsNearBottom(true);
      setReady(true);
    };
    const tick = (ts: number) => {
      if (!start) { start = ts; deadline = ts + 600; }
      el.scrollTop = el.scrollHeight;
      const h = el.scrollHeight;
      if (h === lastH) stable += 1;
      else { lastH = h; stable = 0; }
      // 连续稳定且度过最小期(让首波测量落地)即收敛;超时强制收敛显形,避免长会话久等。
      const settled = stable >= 6 && ts - start >= 120;
      if (!settled && ts < deadline) {
        raf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    const el = scrollRef.current;
    if (el) smoothScrollToBottom(el);
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  /**
   * 发送消息后调用(prompt-pin):标记待 pin 的用户消息 index,由跟随 effect 在 DOM 更新后
   * 把它定位到视口中部偏上(下方留白给回复生长,参考 ChatGPT)。用 pending 而非立即执行,
   * 确保目标消息已渲染(避开 rAF 时序竞态)。
   */
  const pinToMessageTop = useCallback((index: number) => {
    pendingPinRef.current = index;
  }, []);

  return { scrollRef, endRef, isNearBottom, ready, onScroll: handleScroll, scrollToBottom, pinToMessageTop };
}
