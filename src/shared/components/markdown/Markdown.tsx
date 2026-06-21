"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";

interface MarkdownProps {
  /** 待渲染的 markdown 文本(流式增量时会持续变化)。 */
  content: string;
  /** 是否正在流式接收(true 时启用未闭合块解析,避免抖动)。 */
  isStreaming?: boolean;
  className?: string;
}

/**
 * 流式友好的 Markdown 渲染组件(streamdown 封装)。
 *
 * 相比 react-markdown 的优势:
 *   - 流式优化:未闭合的代码块/表格在 isStreaming=true 时优雅解析,不闪烁
 *   - 内置 GFM(表格/任务列表/删除线)+ KaTeX 数学 + Mermaid 图 + Shiki 代码高亮
 *   - 安全:内置 rehype-harden 防 XSS
 *
 * 用法:
 *   <Markdown content={msg.content} isStreaming={streaming} />
 *
 * 注:Tailwind 类扫描配置见 globals.css 的 @source 指令。
 */
function MarkdownImpl({ content, isStreaming, className }: MarkdownProps) {
  return (
    <div className={className}>
      <Streamdown mode={isStreaming ? "streaming" : "static"}>{content}</Streamdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
