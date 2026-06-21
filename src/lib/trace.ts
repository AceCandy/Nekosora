/**
 * process_trace 构造器 —— 记录实际发送给模型的 prompt 结构。
 *
 * 借鉴 DEEIX-Chat 的 MessagePromptTrace:把组装后的 system 块按来源拆成 blocks,
 * 每个 block 带 kind/title/tokenEstimate,供调试"模型实际看到了什么"。
 *
 * 约定:assembleContext 产出的 system 消息用 "\n\n---\n\n" 分隔各 slot。
 * 这里按分隔符拆块,推断 kind(基于内容前缀标记)。
 */
import type { ProcessTrace, ProcessTraceBlock } from "@/db/types";
import { estimateTokens } from "@/lib/tokens";

const BLOCK_SEPARATOR = "\n\n---\n\n";

/** 从组装后的 messages 推断 trace blocks。 */
export function buildTrace(
  messages: { role: string; content: string | unknown[] }[],
): ProcessTrace {
  const blocks: ProcessTraceBlock[] = [];
  let fullCount = 0;
  let sentTokens = 0;

  for (const m of messages) {
    fullCount++;
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    sentTokens += estimateTokens(text);

    // system 消息可能含多个 slot(用 BLOCK_SEPARATOR 分隔),拆成独立 block
    if (m.role === "system") {
      const parts = text.split(BLOCK_SEPARATOR).filter(Boolean);
      for (const part of parts) {
        blocks.push(inferBlock(part));
      }
    } else {
      blocks.push({
        kind: m.role,
        title: m.role === "user" ? "用户消息" : m.role === "assistant" ? "助手消息" : m.role,
        tokenEstimate: estimateTokens(text),
      });
    }
  }

  return {
    mode: "standard",
    totalTokenEstimate: sentTokens,
    sentTokenEstimate: sentTokens,
    fullMessageCount: fullCount,
    sentMessageCount: fullCount,
    blocks,
  };
}

/** 根据内容标记推断 block 的 kind/title。 */
function inferBlock(text: string): ProcessTraceBlock {
  const tokenEstimate = estimateTokens(text);
  // 按注入时的前缀标记推断 kind
  if (text.startsWith("[先前对话摘要]")) {
    return { kind: "compaction", title: "上下文压缩摘要", tokenEstimate, cacheable: false };
  }
  if (text.startsWith("[用户偏好]")) {
    return { kind: "memory_preference", title: "用户偏好记忆", tokenEstimate, cacheable: false, sourceCount: 1 };
  }
  if (text.startsWith("[用户画像]")) {
    return { kind: "memory_profile", title: "用户画像记忆", tokenEstimate, cacheable: false, sourceCount: 1 };
  }
  if (text.startsWith("以下是与当前问题相关的文件参考")) {
    return { kind: "file_context", title: "文件上下文(RAG)", tokenEstimate, cacheable: true };
  }
  // 无标记的 system 块 → 模型默认 system
  return { kind: "system", title: "系统提示", tokenEstimate, cacheable: true };
}
