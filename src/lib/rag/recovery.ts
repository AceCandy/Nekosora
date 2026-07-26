import { and, asc, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { redactErrorMessage } from "@/lib/redaction";
import { processFile } from "./process";

const DATABASE_NOW = sql`now()`;
const STALE_FILE_SCAN_LIMIT = 25;
const STALE_FILE_SCAN_INTERVAL_MS = 60_000;

/** 顺序恢复租约为空或已过期的文件处理任务。 */
export async function recoverStaleFileProcessing(): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const files = await db
    .select({
      id: s.fileObjects.id,
      storagePath: s.fileObjects.storagePath,
      mime: s.fileObjects.mime,
    })
    .from(s.fileObjects)
    .where(
      and(
        inArray(s.fileObjects.processingStatus, ["extracting", "embedding"]),
        or(
          isNull(s.fileObjects.processingLeaseExpiresAt),
          lte(s.fileObjects.processingLeaseExpiresAt, DATABASE_NOW),
        ),
      ),
    )
    .orderBy(
      sql`${s.fileObjects.processingLeaseExpiresAt} ASC NULLS FIRST`,
      asc(s.fileObjects.createdAt),
    )
    .limit(STALE_FILE_SCAN_LIMIT);

  for (const file of files) {
    try {
      await processFile(file.id, file.storagePath, file.mime);
    } catch (error) {
      console.error(
        `[file-processing-recovery] failed for ${file.id}:`,
        redactErrorMessage(error, [], "文件恢复失败").slice(0, 200),
      );
    }
  }
}

/** 启动单飞恢复调度，返回会等待当前扫描完成的停止函数。 */
export function startFileProcessingRecovery(
  recover: () => Promise<void> = recoverStaleFileProcessing,
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const run = () => {
    if (stopped || inFlight) return;
    const pending = Promise.resolve()
      .then(recover)
      .catch((error) => {
        console.error(
          "[file-processing-recovery] scan failed:",
          redactErrorMessage(error, [], "文件恢复扫描失败").slice(0, 200),
        );
      });
    inFlight = pending;
    void pending.finally(() => {
      if (inFlight === pending) inFlight = null;
    });
  };

  run();
  const timer = setInterval(run, STALE_FILE_SCAN_INTERVAL_MS);
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
