"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** 距离底部多少像素内仍视为"贴底"(用于自动跟随)。 */
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
 * 聊天滚动控制器。
 *
 * 行为:
 * - 用户贴底时,新消息到达自动跟随到底部。
 * - 用户上滑离开底部,立即停止自动跟随,避免流式输出抢不走滚动。
 * - forceFollow() 用于「用户主动发送消息」场景:无视当前是否贴底,强制滚到底并恢复跟随。
 * - scrollToBottom() 平滑回到底部并恢复跟随。
 *
 * 两套贴底阈值:
 * - 跟随(窄,BOTTOM_THRESHOLD):内部 ref 驱动自动跟随——用户稍微上滑即停跟随;不对外
 *   暴露 state,避免无消费者时的冗余重渲染。
 * - isNearBottom(宽,NEAR_BOTTOM_RATIO × 视口高):对外 state,供「回到最新」按钮显隐——
 *   距底 ≤ 1/3 屏视为在最新附近、按钮隐藏,避免必须几乎贴底按钮才消失。
 *
 * 两者在 onScroll 与消息变化后(延迟一帧重算)同步更新,校正流式状态转换
 * (流结束、底部缓冲 h-32→h-0、虚拟滚动动态测量)未触发滚动事件时的状态残留。
 */
export function useChatScrollController<T>(messages: T[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 跟随用贴底 ref(窄阈值),仅供内部 effect 读取。
  const isAtBottomRef = useRef(true);
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

  const handleScroll = useCallback(() => {
    isAtBottomRef.current = measureBottom();
    const nearBottom = measureNearBottom();
    isNearBottomRef.current = nearBottom;
    setIsNearBottom(nearBottom);
  }, [measureBottom, measureNearBottom]);

  // 仅在贴底时跟随到底。流式高频触发用 auto(瞬时),避免和 smooth 抢帧;
  // 挂载时同样瞬时滚到底,确保历史会话打开即处于贴底态。
  useEffect(() => {
    if (isAtBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
    // 消息变化后重算贴底/附近状态(延迟一帧等虚拟滚动测量稳定),
    // 校正未触发滚动事件时状态残留导致的按钮误显。
    const raf = requestAnimationFrame(() => {
      isAtBottomRef.current = measureBottom();
      const nearBottom = measureNearBottom();
      isNearBottomRef.current = nearBottom;
      setIsNearBottom(nearBottom);
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, measureBottom, measureNearBottom]);

  // 历史会话挂载:虚拟滚动 measureElement 的 estimateSize 是粗估,真实高度要在挂载后逐条测出。
  // 若可见状态下贴底,用户会看到「估算底部 → 真实底部」的测量追赶滚动(体感差)。解法
  // hide-until-settled:外层消息区在 ready 前保持 opacity-0,本循环在不可见态持续贴底,直到
  // scrollHeight 连续稳定(测量收敛)再 setReady(true) 触发淡入显形——用户看到的是直接出现
  // 在底部 + 淡入,无任何滚动动作。不读 isAtBottomRef:它会被上面消息变化 effect 在测量未完成
  // 时误判为 false,导致循环空转不贴底;初始加载无条件贴底,收敛后再写回贴底态。
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
      isAtBottomRef.current = true;
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
    isAtBottomRef.current = true;
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    const el = scrollRef.current;
    if (el) smoothScrollToBottom(el);
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  /** 用户主动发送消息时调用:强制滚到底并恢复跟随。 */
  const forceFollow = useCallback(() => {
    isAtBottomRef.current = true;
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    const el = scrollRef.current;
    if (el) smoothScrollToBottom(el);
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  return { scrollRef, endRef, isNearBottom, ready, onScroll: handleScroll, scrollToBottom, forceFollow };
}
