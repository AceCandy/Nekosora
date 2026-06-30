"use client";

import { memo } from "react";
import { Streamdown, type AllowedTags, type ControlsConfig } from "streamdown";
import {
  MarkdownHTMLDiv,
  MarkdownHTMLSection,
  MarkdownHTMLArticle,
  MarkdownHTMLAside,
  MarkdownHTMLMain,
  MarkdownHTMLParagraph,
  MarkdownHTMLDetails,
  MarkdownHTMLSummary,
  MarkdownHTMLSpan,
} from "./streamdown-html";

interface MarkdownProps {
  /** 待渲染的 markdown 文本(流式增量时会持续变化)。 */
  content: string;
  /** 是否正在流式接收(true 时启用未闭合块解析,避免抖动)。 */
  isStreaming?: boolean;
  className?: string;
}

/**
 * 放行 HTML 块标签及其 style 属性的白名单。
 * streamdown 内部据此扩展 rehype-sanitize schema,使 AI 输出的
 * 带样式 HTML(如多色卡片布局)能被解析;style 的安全过滤由
 * streamdown-html 的自定义组件承担。
 */
const ALLOWED_HTML_TAGS: AllowedTags = {
  div: ["style"],
  span: ["style"],
  p: ["style"],
  section: ["style"],
  article: ["style"],
  aside: ["style"],
  main: ["style"],
  details: ["open", "style"],
  summary: ["style"],
};

/** 自定义组件映射:对放行的 HTML 标签做 style 安全过滤。 */
const HTML_COMPONENTS = {
  div: MarkdownHTMLDiv,
  section: MarkdownHTMLSection,
  article: MarkdownHTMLArticle,
  aside: MarkdownHTMLAside,
  main: MarkdownHTMLMain,
  p: MarkdownHTMLParagraph,
  details: MarkdownHTMLDetails,
  summary: MarkdownHTMLSummary,
  span: MarkdownHTMLSpan,
};

/**
 * 关闭 streamdown 默认浮层控件。
 * 默认会给表格(复制/下载/全屏)、代码块(复制/下载)叠加操作按钮,
 * 在聊天正文里显得拥挤,这里关掉表格控件与代码块下载,仅保留代码块复制。
 */
const CONTROLS: ControlsConfig = {
  table: false,
  code: { copy: true, download: false },
};

/**
 * 流式友好的 Markdown 渲染组件(streamdown 封装)。
 *
 * 相比 react-markdown 的优势:
 *   - 流式优化:未闭合的代码块/表格在 isStreaming=true 时优雅解析,不闪烁
 *   - 内置 GFM(表格/任务列表/删除线)+ KaTeX 数学 + Mermaid 图 + Shiki 代码高亮
 *   - 安全:内置 rehype-harden 防 XSS
 *   - 放行 AI 输出的带样式 HTML 块,style 经白名单过滤 + 中性色映射(适配暗色)
 *
 * 用法:
 *   <Markdown content={msg.content} isStreaming={streaming} />
 *
 * 注:Tailwind 类扫描配置见 globals.css 的 @source 指令。
 */
function MarkdownImpl({ content, isStreaming, className }: MarkdownProps) {
  return (
    <div className={className}>
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        allowedTags={ALLOWED_HTML_TAGS}
        components={HTML_COMPONENTS}
        controls={CONTROLS}
      >
        {content}
      </Streamdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
