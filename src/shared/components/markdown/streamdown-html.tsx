"use client";

import * as React from "react";
import { clsx } from "clsx";
import { sanitizeHTMLStyle } from "./streamdown-style";

/**
 * 自定义 HTML 块/内联组件:在透传 streamdown 解析出的 style 前,
 * 用 sanitizeHTMLStyle 做白名单过滤 + 危险值拦截 + 中性色映射。
 *
 * 这些组件对应 allowedTags 中放行 style 的标签(div/span/p/section 等)。
 * 若不自定义,style 会原样透传,失去安全过滤。
 */

type BlockProps = React.HTMLAttributes<HTMLElement> & { node?: unknown };
type InlineProps = React.HTMLAttributes<HTMLSpanElement> & { node?: unknown };
type DetailsProps = React.DetailsHTMLAttributes<HTMLDetailsElement> & { node?: unknown };

/** 块级标签工厂:生成带安全 style 过滤的组件。 */
function makeBlock(tag: "div" | "section" | "article" | "aside" | "main" | "p") {
  const Comp = ({ children, className, node: _node, style, ...rest }: BlockProps) =>
    React.createElement(
      tag,
      { className: clsx("min-w-0 max-w-full", className), style: sanitizeHTMLStyle(style), ...rest },
      children,
    );
  return Comp;
}

export const MarkdownHTMLDiv = makeBlock("div");
export const MarkdownHTMLSection = makeBlock("section");
export const MarkdownHTMLArticle = makeBlock("article");
export const MarkdownHTMLAside = makeBlock("aside");
export const MarkdownHTMLMain = makeBlock("main");
export const MarkdownHTMLParagraph = makeBlock("p");

export function MarkdownHTMLDetails({ children, className, node: _node, style, ...rest }: DetailsProps) {
  return (
    <details className={clsx("min-w-0 max-w-full", className)} style={sanitizeHTMLStyle(style)} {...rest}>
      {children}
    </details>
  );
}

export function MarkdownHTMLSummary({ children, className, node: _node, style, ...rest }: BlockProps) {
  return (
    <summary className={clsx("min-w-0 max-w-full", className)} style={sanitizeHTMLStyle(style)} {...rest}>
      {children}
    </summary>
  );
}

export function MarkdownHTMLSpan({ children, className, node: _node, style, ...rest }: InlineProps) {
  return (
    <span className={clsx("min-w-0 max-w-full", className)} style={sanitizeHTMLStyle(style)} {...rest}>
      {children}
    </span>
  );
}
