import type { ControlsConfig } from "streamdown";

/**
 * Streamdown 内置代码块 actions 会额外生成 sticky 浮层,在聊天正文里留白过大。
 * Nekosora 统一在 MarkdownCodeBlock 内渲染紧凑复制/预览按钮,所以这里彻底关闭原生 code actions。
 */
export const MARKDOWN_CONTROLS = {
  table: false,
  code: false,
} satisfies ControlsConfig;
