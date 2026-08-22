"use client";

/**
 * 文本垂直滚动替换（借鉴 DEEIX animated-text）：text 变化时旧文本上滑淡出、
 * 新文本自 8px 下方淡入（180ms expo）。用于会话自动重命名后的标题丝滑换字。
 * 实现要点：渲染期调整 state（React 推荐模式，避开 effect 内同步 setState），
 * 离场层动画结束即卸载；受全局 prefers-reduced-motion 兜底压至瞬时。
 */
import { useState } from "react";
import { clsx } from "clsx";

export function AnimatedText({ text, className }: { text: string; className?: string }) {
  const [current, setCurrent] = useState(text);
  const [leaving, setLeaving] = useState<string | null>(null);
  // 渲染期调整：props 文本与当前显示不一致时,旧文本进入离场层、新文本接管
  if (current !== text) {
    setLeaving(current);
    setCurrent(text);
  }

  return (
    <span className={clsx("relative block min-w-0 overflow-hidden", className)}>
      {leaving !== null && leaving !== current && (
        <span
          aria-hidden="true"
          className="ai-text-out absolute inset-0 block truncate"
          onAnimationEnd={() => setLeaving(null)}
        >
          {leaving}
        </span>
      )}
      <span key={current} className={clsx("block truncate", leaving !== null && leaving !== current && "ai-text-in")}>
        {current}
      </span>
    </span>
  );
}
