"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** 距离底部多少像素内仍视为"贴底"。 */
const BOTTOM_THRESHOLD = 24;

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
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  /** 用户主动发送消息时调用:强制滚到底并恢复跟随。 */
  const forceFollow = useCallback(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  return { scrollRef, endRef, isAtBottom, onScroll: handleScroll, scrollToBottom, forceFollow };
}
