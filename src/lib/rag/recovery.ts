import { processFile } from "./processing-coordinator";
import { findRecoverableFileIds } from "./processing-repository";
import { formatFileProcessingError } from "./processing-state";

const STALE_FILE_SCAN_INTERVAL_MS = 60_000;

/** 顺序恢复 pending 或租约为空/已过期的文件处理任务。 */
export async function recoverStaleFileProcessing(): Promise<void> {
  const fileIds = await findRecoverableFileIds();

  for (const fileId of fileIds) {
    try {
      await processFile(fileId);
    } catch (error) {
      console.error(
        `[file-processing-recovery] failed for ${fileId}:`,
        formatFileProcessingError(error, [], "文件恢复失败"),
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
          formatFileProcessingError(error, [], "文件恢复扫描失败"),
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
