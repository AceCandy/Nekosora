/**
 * 文本分块 —— 简单按字符滑窗切分(段落感知)。
 *
 * 不依赖外部库;对内部团队规模够用。chunkSize/overlap 可配。
 */
import { estimateTokens } from "@/lib/tokens";

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  charOffset: number;
}

const DEFAULT_CHUNK_SIZE = 800; // 字符
const DEFAULT_OVERLAP = 100;

/** 将文本切成带重叠的块。尽量在段落/句子边界切。 */
export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): Chunk[] {
  if (!text || !text.trim()) return [];

  const chunks: Chunk[] = [];
  let offset = 0;
  let idx = 0;

  while (offset < text.length) {
    let end = Math.min(offset + chunkSize, text.length);
    // 尽量在换行/句号处收尾
    if (end < text.length) {
      const window = text.slice(offset, end);
      const lastBreak = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf("。"),
        window.lastIndexOf(". "),
      );
      if (lastBreak > chunkSize * 0.5) end = offset + lastBreak + 1;
    }
    const content = text.slice(offset, end).trim();
    if (content) {
      chunks.push({
        index: idx++,
        content,
        tokenCount: estimateTokens(content),
        charOffset: offset,
      });
    }
    offset = end - overlap;
    if (offset < 0 || end >= text.length) break;
  }
  return chunks;
}
