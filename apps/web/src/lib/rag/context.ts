/**
 * 文件上下文构造器 —— 三模式将文件内容注入对话消息。
 *
 *   auto         小文件全文注入,大文件走 RAG 检索(默认)
 *   full_context 直接注入文件全文(超 token 预算则截断)
 *   rag          始终走向量检索(只注入相关片段)
 *
 * 输出增强后的 messages(system 块里带文件上下文)+ ragStatus。
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { retrieve, type RetrieveStatus } from "./retrieve";
import { estimateTokens } from "@/lib/tokens";

const FULL_CONTEXT_TOKEN_LIMIT = 4000; // full_context 模式的注入上限
const AUTO_FULL_THRESHOLD = 1500; // auto 模式下,文件 ≤ 此 token 数则全文注入

export type FileMode = "auto" | "full_context" | "rag";

export interface BuildContextInput {
  userId: string;
  messages: { role: string; content: string | unknown[] }[];
  fileIds: string[];
  fileMode: FileMode;
  query: string;
}

export interface BuildContextOutput {
  messages: { role: string; content: string | unknown[] }[];
  ragStatus: RetrieveStatus | "full_text" | "skipped";
}

export async function buildMessagesWithFileContext(
  input: BuildContextInput,
): Promise<BuildContextOutput> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 取文件(限定属主 + rag_ready 或可读)
  const fileRows = await db
    .select()
    .from(s.fileObjects)
    .where(
      and(
        inArray(s.fileObjects.id, input.fileIds),
        eq(s.fileObjects.userId, input.userId),
      ),
    );

  if (fileRows.length === 0) {
    return { messages: input.messages, ragStatus: "skipped" };
  }

  // 决定模式:auto 根据文件大小分流
  let mode = input.fileMode;
  if (mode === "auto") {
    const totalTextTokens = await getTotalTextTokens(fileRows);
    mode = totalTextTokens <= AUTO_FULL_THRESHOLD ? "full_context" : "rag";
  }

  if (mode === "full_context") {
    return buildFullContext(input, fileRows, db, s);
  }
  return buildRagContext(input, fileRows);
}

/** full_context:把文件全文拼进 system 块(截断到预算)。 */
async function buildFullContext(
  input: BuildContextInput,
  fileRows: Record<string, unknown>[],
  db: Awaited<ReturnType<typeof getDb>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
): Promise<BuildContextOutput> {
  const parts: string[] = [];
  let used = 0;
  for (const f of fileRows) {
    const fileId = f.id as string;
    // 取该文件的全文(拼接所有 chunk)
    const chunks = await db.select().from(s.fileChunks).where(eq(s.fileChunks.fileId, fileId));
    const fullText = (chunks as Record<string, unknown>[])
      .sort((a, b) => (a.chunkIndex as number) - (b.chunkIndex as number))
      .map((c) => c.content as string)
      .join("\n\n");
    if (!fullText) continue;
    const cost = estimateTokens(fullText);
    if (used + cost > FULL_CONTEXT_TOKEN_LIMIT) break;
    parts.push(`--- 文件:${f.filename as string} ---\n${fullText}`);
    used += cost;
  }
  if (parts.length === 0) {
    return { messages: input.messages, ragStatus: "rag_empty" };
  }
  return {
    messages: injectContext(input.messages, parts.join("\n\n")),
    ragStatus: "full_text",
  };
}

/** rag:向量检索相关片段。 */
async function buildRagContext(
  input: BuildContextInput,
  fileRows: Record<string, unknown>[],
): Promise<BuildContextOutput> {
  const ownedFileIds = fileRows.map((file) => file.id as string);
  const result = await retrieve(input.query, ownedFileIds, { userId: input.userId });
  if (result.status !== "rag_hit" || result.chunks.length === 0) {
    return { messages: input.messages, ragStatus: result.status };
  }
  // 按文件分组拼成上下文块
  const byFile = new Map<string, { filename: string; fragments: string[] }>();
  for (const c of result.chunks) {
    const entry = byFile.get(c.fileId) ?? { filename: c.filename, fragments: [] };
    entry.fragments.push(c.content);
    byFile.set(c.fileId, entry);
  }
  const parts: string[] = [];
  for (const [, e] of byFile) {
    parts.push(`--- 文件:${e.filename}(检索片段) ---\n${e.fragments.join("\n\n---\n\n")}`);
  }
  return {
    messages: injectContext(input.messages, parts.join("\n\n")),
    ragStatus: "rag_hit",
  };
}

/** 把文件上下文注入到 messages:作为 system 消息插在最前(或合并已有 system)。 */
function injectContext(
  messages: { role: string; content: string | unknown[] }[],
  fileContext: string,
): { role: string; content: string | unknown[] }[] {
  const contextBlock = `以下是与当前问题相关的文件参考:\n\n${fileContext}\n\n请基于以上内容回答用户问题。`;
  const out = [...messages];
  if (out[0]?.role === "system") {
    const prev = typeof out[0].content === "string" ? out[0].content : "";
    out[0] = { role: "system", content: `${prev}\n\n${contextBlock}` };
  } else {
    out.unshift({ role: "system", content: contextBlock });
  }
  return out;
}

/** 估算这些文件的总文本 token(用于 auto 模式分流)。 */
async function getTotalTextTokens(fileRows: Record<string, unknown>[]): Promise<number> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  let total = 0;
  for (const f of fileRows) {
    const chunks = await db.select().from(s.fileChunks).where(eq(s.fileChunks.fileId, f.id as string));
    for (const c of chunks as Record<string, unknown>[]) {
      total += c.tokenCount as number;
    }
  }
  return total;
}
