/**
 * 文件处理流水线 —— extract → chunk → embed → persist → rag_ready。
 *
 * 被 worker.ts(队列消费)和 upload 端点(队列不可用时同步 fallback)调用。
 * 每步更新 file_objects 状态,失败时记录 embed_error/rag_reason。
 */
import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { extractText } from "./extract";
import { chunkText } from "./chunk";
import { embedTexts } from "./embedding";
import { isEmbeddingAvailable } from "./embedding";

/**
 * 处理一个文件:提取 → 分块 → 嵌入 → 入库 → 标记 rag_ready。
 * 幂等:重复处理会先删旧块再重插。
 */
export async function processFile(fileId: string, storagePath: string, mime: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const update = (patch: Record<string, unknown>) =>
    db.update(s.fileObjects).set(patch).where(eq(s.fileObjects.id, fileId));

  try {
    // 1. 提取
    await update({ processingStatus: "extracting", extractStatus: "running" });
    const extracted = await extractText(storagePath, mime);
    if (!extracted.supported) {
      await update({
        processingStatus: "done",
        extractStatus: "skipped",
        ragReady: false,
        ragReason: extracted.reason ?? "unsupported",
      });
      return;
    }
    await update({
      extractStatus: "done",
      extractEngine: "builtin",
      extractChars: extracted.chars,
      extractPages: extracted.pages,
      pageCount: extracted.pages,
    });

    // 2. 分块
    const chunks = chunkText(extracted.text);
    await update({ processingStatus: "embedding", chunkCount: chunks.length });

    if (chunks.length === 0) {
      await update({ processingStatus: "done", ragReady: false, ragReason: "empty_text" });
      return;
    }

    // 3. 嵌入(embedding 不可用则只存文本块,标记不可检索)
    const embeddingOk = await isEmbeddingAvailable();
    let embeddings: (number[] | null)[] = chunks.map(() => null);
    if (embeddingOk) {
      try {
        await update({ embedStatus: "running" });
        embeddings = await embedTexts(chunks.map((c) => c.content));
        await update({ embedStatus: "done" });
      } catch (err) {
        await update({ embedStatus: "error", embedError: err instanceof Error ? err.message : "embed failed" });
        // 继续存文本块,但不标记 rag_ready
      }
    } else {
      await update({ embedStatus: "skipped", embedError: "embedding_unavailable" });
    }

    // 4. 持久化块(先删旧)
    await db.delete(s.fileChunks).where(eq(s.fileChunks.fileId, fileId));
    const rows = chunks.map((c, i) => ({
      fileId,
      chunkIndex: c.index,
      pageNum: extracted.pages ? Math.floor(c.charOffset / 2000) + 1 : null,
      charOffset: c.charOffset,
      content: c.content,
      tokenCount: c.tokenCount,
      embedding: embeddingOk && embeddings[i] ? JSON.stringify(embeddings[i]) : null,
    }));
    // 分批插入(避免单次过大)
    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      await db.insert(s.fileChunks).values(rows.slice(i, i + BATCH));
    }

    // 5. 标记完成
    await update({
      processingStatus: "done",
      ragReady: embeddingOk,
      ragReason: embeddingOk ? null : "embedding_unavailable",
    });
  } catch (err) {
    console.error("[processFile] failed:", err);
    await update({
      processingStatus: "error",
      ragReady: false,
      ragReason: err instanceof Error ? err.message : "processing_error",
    });
  }
}
