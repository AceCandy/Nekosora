import { chunkText } from "./chunk";
import { embedTexts, isEmbeddingAvailable } from "./embedding";
import { extractText } from "./extract";
import type { JobOutcome } from "@/lib/jobs/catalog";
import {
  claimFileProcessing,
  completeFileProcessingWithoutChunks,
  failFileProcessing,
  renewFileProcessingLease,
  replaceFileChunksAndComplete,
  transitionFileProcessing,
  type FileProcessingLease,
} from "./processing-repository";
import {
  FileProcessingLeaseLostError,
  RetryableFileProcessingError,
  formatFileProcessingError,
  normalizeUnsupportedReason,
  type RetryableFileProcessingReason,
} from "./processing-state";

const FILE_PROCESSING_HEARTBEAT_INTERVAL_MS = 30_000;

interface FileProcessingHeartbeat {
  assertOwned(): void;
  stop(): Promise<void>;
}

function startFileProcessingHeartbeat(
  lease: FileProcessingLease,
): FileProcessingHeartbeat {
  let leaseLost = false;
  let inFlight: Promise<void> | null = null;

  const timer = setInterval(() => {
    if (leaseLost || inFlight) return;
    const pending = renewFileProcessingLease(lease).catch(() => {
      leaseLost = true;
    });
    inFlight = pending;
    void pending.finally(() => {
      if (inFlight === pending) inFlight = null;
    });
  }, FILE_PROCESSING_HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return {
    assertOwned() {
      if (leaseLost) throw new FileProcessingLeaseLostError();
    },
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}

/** 以数据库记录为事实源，执行 extract -> chunk -> embed -> persist。 */
export async function processFile(fileId: string): Promise<JobOutcome> {
  let claimed;
  try {
    claimed = await claimFileProcessing(fileId);
  } catch {
    throw new RetryableFileProcessingError();
  }
  if (!claimed) return "noop";

  const { lease, storagePath, mime } = claimed;
  const heartbeat = startFileProcessingHeartbeat(lease);
  let retryableReason: RetryableFileProcessingReason = "extraction_failed";

  try {
    const extracted = await extractText(storagePath, mime);
    heartbeat.assertOwned();
    if (!extracted.supported) {
      retryableReason = "persistence_failed";
      await completeFileProcessingWithoutChunks(lease, "extracting", {
        type: "complete-unsupported",
        reason: normalizeUnsupportedReason(extracted.reason),
      });
      return "completed";
    }

    retryableReason = "persistence_failed";
    await transitionFileProcessing(lease, "extracting", {
      type: "complete-extraction",
      chars: extracted.chars,
      pages: extracted.pages,
    });

    retryableReason = "chunking_failed";
    const chunks = chunkText(extracted.text);
    heartbeat.assertOwned();
    retryableReason = "persistence_failed";
    await transitionFileProcessing(lease, "extracting", {
      type: "start-embedding",
      chunkCount: chunks.length,
    });

    if (chunks.length === 0) {
      await completeFileProcessingWithoutChunks(lease, "embedding", {
        type: "complete-empty",
      });
      return "completed";
    }

    let embeddings: number[][] = [];
    let embeddingSucceeded = false;
    let degradedReason: "embedding_unavailable" | "embedding_failed" | null = null;
    let embeddingAvailable: boolean;
    try {
      embeddingAvailable = await isEmbeddingAvailable();
      heartbeat.assertOwned();
    } catch (error) {
      if (error instanceof FileProcessingLeaseLostError) throw error;
      heartbeat.assertOwned();
      const diagnostic = formatFileProcessingError(
        error,
        [storagePath],
        "embedding_failed",
      );
      await transitionFileProcessing(lease, "embedding", {
        type: "mark-embedding-failed",
        diagnostic,
      });
      console.error("[file-processing] embedding degraded:", diagnostic);
      embeddingAvailable = false;
      degradedReason = "embedding_failed";
    }

    if (degradedReason === null && !embeddingAvailable) {
      await transitionFileProcessing(lease, "embedding", {
        type: "mark-embedding-skipped",
      });
      degradedReason = "embedding_unavailable";
    } else if (degradedReason === null) {
      await transitionFileProcessing(lease, "embedding", {
        type: "mark-embedding-running",
      });
      try {
        embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
        heartbeat.assertOwned();
        if (embeddings.length !== chunks.length) {
          throw new Error("embedding response count mismatch");
        }
        await transitionFileProcessing(lease, "embedding", {
          type: "mark-embedding-done",
        });
        embeddingSucceeded = true;
      } catch (error) {
        if (error instanceof FileProcessingLeaseLostError) throw error;
        heartbeat.assertOwned();
        const diagnostic = formatFileProcessingError(
          error,
          [storagePath],
          "embedding_failed",
        );
        await transitionFileProcessing(lease, "embedding", {
          type: "mark-embedding-failed",
          diagnostic,
        });
        console.error("[file-processing] embedding degraded:", diagnostic);
        degradedReason = "embedding_failed";
      }
    }

    heartbeat.assertOwned();
    retryableReason = "persistence_failed";
    await replaceFileChunksAndComplete(lease, {
      chunks: chunks.map((chunk, index) => ({
        chunkIndex: chunk.index,
        pageNum: extracted.pages ? Math.floor(chunk.charOffset / 2000) + 1 : null,
        charOffset: chunk.charOffset,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: embeddingSucceeded ? embeddings[index] ?? null : null,
      })),
      ragReady: embeddingSucceeded,
      ragReason: embeddingSucceeded ? null : degradedReason ?? "embedding_failed",
    });
    return "completed";
  } catch (error) {
    if (error instanceof FileProcessingLeaseLostError) return "noop";
    const diagnostic = formatFileProcessingError(error, [storagePath], retryableReason);
    try {
      await failFileProcessing(lease, retryableReason);
    } catch (failureError) {
      if (failureError instanceof FileProcessingLeaseLostError) return "noop";
    }
    console.error(`[file-processing] ${retryableReason}:`, diagnostic);
    throw new RetryableFileProcessingError();
  } finally {
    await heartbeat.stop();
  }
}
