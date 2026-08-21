/**
 * Artifact 提取器 —— P1-B。
 *
 * 从 assistant 文本中抽取 fenced code blocks(```...```),按语言归类:
 *   - mermaid   → kind=mermaid
 *   - svg/html  → kind=svg/html
 *   - math/tex  → kind=katex(数学公式块)
 *   - 其他语言  → null(普通代码,正文内联渲染,不抽成 artifact)
 *
 * 设计为纯函数(非流式场景);流式场景可后续扩展为有状态 parser。
 * 当前 WebChat 在流式结束后整体抽取(简化可靠)。
 */

export type ArtifactKind = "code" | "mermaid" | "svg" | "html" | "katex" | "markdown";

export interface ParsedArtifact {
  kind: ArtifactKind;
  title: string;
  language: string | null;
  content: string;
  /** 在原文中的起始位置(便于去重)。 */
  startOffset: number;
}

export interface ExtractResult {
  /** 移除 artifact 后的纯文本(可能含占位标记)。 */
  text: string;
  artifacts: ParsedArtifact[];
}

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

/**
 * 语言 → artifact kind 映射。
 * 返回 null 表示普通代码块,正文内联渲染即可,不抽成 artifact
 * (避免「正文一份 + 末尾可渲染物一份」的双重渲染)。
 */
function classifyLanguage(lang: string): ArtifactKind | null {
  const l = lang.toLowerCase().trim();
  if (l === "mermaid") return "mermaid";
  if (l === "svg") return "svg";
  if (l === "html" || l === "xml") return "html";
  if (l === "math" || l === "tex" || l === "latex") return "katex";
  if (l === "markdown" || l === "md") return "markdown";
  return null;
}

/** 推断标题(从内容首行或语言名)。 */
function inferTitle(kind: ArtifactKind, language: string | null, content: string): string {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  const ext = language ?? kind;
  // 对 mermaid/svg 用图类型,否则用代码首行截断。
  if (kind === "mermaid" || kind === "svg") {
    return `${kind}-diagram`;
  }
  if (firstLine && firstLine.length <= 40) {
    return firstLine.replace(/[#`*]/g, "").trim() || `snippet.${ext || "txt"}`;
  }
  return `artifact.${ext || "txt"}`;
}

/**
 * 从完整 assistant 文本抽取全部 artifact。
 * 保留原文(不做文本删改,仅在 content 中标注 artifact 数量)。
 * 简单策略:原文透传,artifact 单独存储(消息渲染时优先展示文本)。
 */
export function extractArtifacts(text: string): ExtractResult {
  const artifacts: ParsedArtifact[] = [];
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;

  while ((match = FENCE_RE.exec(text)) !== null) {
    const lang = match[1] ?? "";
    const content = match[2] ?? "";
    const kind = classifyLanguage(lang);
    // 普通代码块不抽成 artifact,留给正文内联渲染。
    if (kind === null) continue;
    artifacts.push({
      kind,
      title: inferTitle(kind, lang || null, content),
      language: lang || null,
      content,
      startOffset: match.index,
    });
  }

  return { text, artifacts };
}
