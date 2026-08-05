/**
 * 可预览代码块判定 —— 哪些 fenced code block 适合「点击预览」渲染。
 *
 * 普通代码(js/py/ts/json/bash 等)正文内联显示源码即可,无预览按钮;
 * 仅 html / svg / mermaid 这类「看渲染结果才有意义」的代码块提供预览入口。
 *
 * 返回值与 ArtifactPanel 的 Artifact["kind"] 兼容,可直接传给右侧预览面板。
 * 参考 docs/cankao/DEEIX-Chat 的 resolveArtifactPreviewKind,并扩展 svg / mermaid。
 */

export type PreviewableKind = "html" | "svg" | "mermaid";

const HTML_LIKE_RE =
  /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<(?:article|canvas|div|main|section|style|script|svg)\b)/i;

/**
 * 依据语言标签与代码内容判断是否可预览。
 * 返回 null 表示普通代码块,正文显示源码、不显示预览按钮。
 */
export function resolvePreviewableKind(
  language: string,
  code: string,
): PreviewableKind | null {
  const lang = language.trim().toLowerCase();
  if (lang === "svg") return "svg";
  if (lang === "mermaid" || lang === "mmd") return "mermaid";
  if (lang === "html" || lang === "htm" || lang === "xml") return "html";

  // 未标语言或 markdown:按内容识别 svg / html 文档
  if (!lang || lang === "markdown" || lang === "md") {
    if (/<svg\b/i.test(code)) return "svg";
    if (HTML_LIKE_RE.test(code)) return "html";
  }
  return null;
}
