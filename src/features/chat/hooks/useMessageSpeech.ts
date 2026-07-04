"use client";

import { useSyncExternalStore } from "react";

/**
 * 把 Markdown 文本清洗为适合语音朗读的纯文本：
 * 去掉代码块 / 图片 / 链接 URL / 标题与列表符号 / 强调标记，保留可读文字。
 */
export function plainTextFromMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // 围栏代码块整体跳过(朗读代码无意义)
    .replace(/`([^`]+)`/g, "$1") // 行内代码保留文字
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 链接保留文字
    .replace(/^#{1,6}\s+/gm, "") // 标题符号
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // 无序列表符号
    .replace(/^\s*\d+\.\s+/gm, "") // 有序列表符号
    .replace(/^\s{0,3}>/gm, "") // 引用符号
    .replace(/[*_~]{1,3}/g, "") // 强调/删除线
    .replace(/\|/g, " ") // 表格分隔
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ===== 模块级单例:全局同时只允许一条消息朗读 =====
let currentSpeakingId: string | null = null;
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return currentSpeakingId;
}

function getServerSnapshot(): null {
  return null;
}

/** 停止当前朗读(若有)。 */
export function stopSpeech(): void {
  if (currentSpeakingId === null) return;
  currentSpeakingId = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  emitChange();
}

/** 朗读指定消息:自动停止其它正在朗读的消息。 */
export function speakMessage(id: string, text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text.trim()) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.onend = () => {
    if (currentSpeakingId === id) {
      currentSpeakingId = null;
      emitChange();
    }
  };
  utter.onerror = () => {
    if (currentSpeakingId === id) {
      currentSpeakingId = null;
      emitChange();
    }
  };
  currentSpeakingId = id;
  emitChange();
  window.speechSynthesis.speak(utter);
}

/**
 * 消息朗读 hook:返回浏览器支持度、当前朗读中的消息 id、以及 speak/stop。
 * 跨消息实例共享同一份朗读状态(useSyncExternalStore 订阅模块单例),
 * 保证同一时刻只有一条消息在朗读,新朗读自动停止旧朗读。
 */
export function useMessageSpeech(): {
  supported: boolean;
  speakingId: string | null;
  speak: (id: string, text: string) => void;
  stop: () => void;
} {
  const speakingId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  return { supported, speakingId, speak: speakMessage, stop: stopSpeech };
}
