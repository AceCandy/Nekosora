import type { StructuredKind } from "@nekusora/contracts/structured";

/** 语言标签 → 结构化类型。语言标签优先，不做内容启发。 */
const STRUCTURED_LANGUAGES: Record<string, StructuredKind> = {
  chart: "chart",
  metric: "metric",
  table: "table",
  callout: "callout",
};

/**
 * 判定 fenced code block 是否为结构化块。
 * 返回 null 表示非结构化（走普通源码或 html/svg/mermaid 预览链路）。
 * 与 resolvePreviewableKind 互斥：一种代码块要么结构化内联，要么走预览/源码，不重叠。
 */
export function resolveStructuredKind(language: string): StructuredKind | null {
  const lang = language.trim().toLowerCase();
  return STRUCTURED_LANGUAGES[lang] ?? null;
}
