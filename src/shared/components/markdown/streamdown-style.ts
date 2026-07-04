/**
 * HTML 内联样式过滤器。
 *
 * 当前为原样透传：不对 AI 输出的 style 做属性白名单过滤、危险值拦截、
 * 中性色映射，避免改写 AI 的视觉意图（颜色/字体/背景图等）。
 * 安全兜底依赖 streamdown 内部的 rehype-harden；如需恢复过滤见 git 历史。
 */
import type { CSSProperties } from "react";

/**
 * 原样返回传入的 style，不做任何过滤。
 * 返回 undefined 表示无 style 可渲染。
 */
export function sanitizeHTMLStyle(style: CSSProperties | undefined): CSSProperties | undefined {
  return style;
}
