"use client";

import { useEffect, useRef } from "react";

/**
 * 聊天滚动控制器 —— 消息变化时自动滚到底部。
 *
 * 当前实现:每次 messages 变化即平滑滚动到底部。
 * 后续可增强:用户上滑时暂停自动滚动(检测 scroll 位置)。
 *
 * @returns 绑定到滚动容器末尾的 ref。
 */
export function useChatScrollController<T>(messages: T[]) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return endRef;
}
