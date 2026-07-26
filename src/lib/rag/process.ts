/**
 * 文件处理流水线 —— extract → chunk → embed → persist → rag_ready。
 *
 * 被 worker.ts(队列消费)和 upload 端点(队列不可用时同步 fallback)调用。
 * 每步更新 file_objects 状态,失败时记录 embed_error/rag_reason。
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { extractText } from "./extract";
import { chunkText } from "./chunk";
import { embedTexts } from "./embedding";
import { isEmbeddingAvailable } from "./embedding";

const ACTIVE_PROCESSING_STATUSES = ["extracting", "embedding"];
const FILE_PROCESSING_LEASE_EXPIRES_AT = sql`now() + interval '2 minutes'`;
const FILE_PROCESSING_HEARTBEAT_INTERVAL_MS = 30_000;
const DATABASE_NOW = sql`now()`;
const STATEMENT_TIMESTAMP = sql`statement_timestamp()`;

class FileProcessingLeaseLostError extends Error {}

/**
 * 处理一个文件:提取 → 分块 → 嵌入 → 入库 → 标记 rag_ready。
 * 并发保护:仅成功抢占可处理状态或过期活动租约的调用者进入流水线。
 */
export async function processFile(fileId: string, storagePath: string, mime: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const leaseId = randomUUID();

  const [claimed] = await db
    .update(s.fileObjects)
    .set({
      processingStatus: "extracting",
      processingLeaseId: leaseId,
      processingLeaseExpiresAt: FILE_PROCESSING_LEASE_EXPIRES_AT,
      extractStatus: "running",
    })
    .where(
      and(
        eq(s.fileObjects.id, fileId),
        or(
          inArray(s.fileObjects.processingStatus, ["pending", "error"]),
          and(
            inArray(s.fileObjects.processingStatus, ACTIVE_PROCESSING_STATUSES),
            or(
              isNull(s.fileObjects.processingLeaseExpiresAt),
              lte(s.fileObjects.processingLeaseExpiresAt, DATABASE_NOW),
            ),
          ),
        ),
      ),
    )
    .returning({ id: s.fileObjects.id });
  if (!claimed) return;

  const ownedWhere = (clock: unknown) =>
    and(
      eq(s.fileObjects.id, fileId),
      eq(s.fileObjects.processingLeaseId, leaseId),
      inArray(s.fileObjects.processingStatus, ACTIVE_PROCESSING_STATUSES),
      gt(s.fileObjects.processingLeaseExpiresAt, clock),
    );

  let leaseLost = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatInFlight: Promise<void> | null = null;

  const renewLease = async () => {
    const [renewed] = await db
      .update(s.fileObjects)
      .set({ processingLeaseExpiresAt: FILE_PROCESSING_LEASE_EXPIRES_AT })
      .where(ownedWhere(DATABASE_NOW))
      .returning({ id: s.fileObjects.id });
    if (!renewed) throw new FileProcessingLeaseLostError();
  };

  heartbeatTimer = setInterval(() => {
    if (leaseLost || heartbeatInFlight) return;
    const pending = renewLease().catch(() => {
      leaseLost = true;
    });
    heartbeatInFlight = pending;
    void pending.finally(() => {
      if (heartbeatInFlight === pending) heartbeatInFlight = null;
    });
  }, FILE_PROCESSING_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const update = async (patch: Record<string, unknown>) => {
    if (leaseLost) throw new FileProcessingLeaseLostError();
    const [updated] = await db
      .update(s.fileObjects)
      .set(patch)
      .where(ownedWhere(DATABASE_NOW))
      .returning({ id: s.fileObjects.id });
    if (!updated) throw new FileProcessingLeaseLostError();
  };

  try {
    // 1. 提取
    const extracted = await extractText(storagePath, mime);
    if (!extracted.supported) {
      await update({
        processingStatus: "done",
        extractStatus: "skipped",
        ragReady: false,
        ragReason: extracted.reason ?? "unsupported",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
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
      await update({
        processingStatus: "done",
        ragReady: false,
        ragReason: "empty_text",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
      });
      return;
    }

    // 3. 嵌入(embedding 不可用则只存文本块,标记不可检索)
    const embeddingAvailable = await isEmbeddingAvailable();
    let embeddingSucceeded = false;
    let embeddings: (number[] | null)[] = chunks.map(() => null);
    if (embeddingAvailable) {
      try {
        await update({ embedStatus: "running" });
        embeddings = await embedTexts(chunks.map((c) => c.content));
        await update({ embedStatus: "done" });
        embeddingSucceeded = true;
      } catch (err) {
        if (err instanceof FileProcessingLeaseLostError) throw err;
        await update({ embedStatus: "error", embedError: err instanceof Error ? err.message : "embed failed" });
        // 继续存文本块,但不标记 rag_ready
      }
    } else {
      await update({ embedStatus: "skipped", embedError: "embedding_unavailable" });
    }

    // 4. 持久化块
    const rows = chunks.map((c, i) => ({
      fileId,
      chunkIndex: c.index,
      pageNum: extracted.pages ? Math.floor(c.charOffset / 2000) + 1 : null,
      charOffset: c.charOffset,
      content: c.content,
      tokenCount: c.tokenCount,
      embedding: embeddingSucceeded && embeddings[i] ? JSON.stringify(embeddings[i]) : null,
    }));
    if (leaseLost) throw new FileProcessingLeaseLostError();
    await db.transaction(async (tx: typeof db) => {
      const [locked] = await tx
        .update(s.fileObjects)
        .set({ processingLeaseExpiresAt: FILE_PROCESSING_LEASE_EXPIRES_AT })
        .where(ownedWhere(DATABASE_NOW))
        .returning({ id: s.fileObjects.id });
      if (!locked) throw new FileProcessingLeaseLostError();

      await tx.delete(s.fileChunks).where(eq(s.fileChunks.fileId, fileId));
      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        await tx.insert(s.fileChunks).values(rows.slice(i, i + BATCH));
      }

      const [completed] = await tx
        .update(s.fileObjects)
        .set({
          processingStatus: "done",
          ragReady: embeddingSucceeded,
          ragReason: embeddingSucceeded
            ? null
            : embeddingAvailable
              ? "embedding_failed"
              : "embedding_unavailable",
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
        })
        .where(ownedWhere(STATEMENT_TIMESTAMP))
        .returning({ id: s.fileObjects.id });
      if (!completed) throw new FileProcessingLeaseLostError();
    });
  } catch (err) {
    if (err instanceof FileProcessingLeaseLostError) return;
    console.error("[processFile] failed:", err);
    try {
      await update({
        processingStatus: "error",
        ragReady: false,
        ragReason: err instanceof Error ? err.message : "processing_error",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
      });
    } catch (updateError) {
      if (!(updateError instanceof FileProcessingLeaseLostError)) throw updateError;
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await heartbeatInFlight;
  }
}
