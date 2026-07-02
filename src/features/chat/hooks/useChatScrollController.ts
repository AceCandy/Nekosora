"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** 距离底部多少像素内仍视为"贴底"。 */
const BOTTOM_THRESHOLD = 24;
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
 * 注意:打开历史会话时初始 isAtBottom=true,跟随 effect 会瞬时把视图滚到底,
 * 使 onScroll 首次触发时即处于贴底态,不会误显「跳到最新」按钮。
 */
export function useChatScrollController<T>(messages: T[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 用 ref 存最新值,供 messages 变化的 effect 读取,避免闭包陈旧。
  const isAtBottomRef = useRef(true);

  const measureBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  const handleScroll = useCallback(() => {
    const atBottom = measureBottom();
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, [measureBottom]);

  // 仅在贴底时跟随到底。流式高频触发用 auto(瞬时),避免和 smooth 抢帧;
  // 挂载时同样瞬时滚到底,确保历史会话打开即处于贴底态。
  useEffect(() => {
    if (isAtBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    const el = scrollRef.current;
    if (el) smoothScrollToBottom(el);
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  /** 用户主动发送消息时调用:强制滚到底并恢复跟随。 */
  const forceFollow = useCallback(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    const el = scrollRef.current;
    if (el) smoothScrollToBottom(el);
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  return { scrollRef, endRef, isAtBottom, onScroll: handleScroll, scrollToBottom, forceFollow };
}
