import { processFile } from "./processing-coordinator";
import { findRecoverableFileIds } from "./processing-repository";

/** 顺序恢复 pending 或租约为空/已过期的文件处理任务。 */
export async function recoverStaleFileProcessing(): Promise<void> {
  const fileIds = await findRecoverableFileIds();

  for (const fileId of fileIds) {
    try {
      await processFile(fileId);
    } catch {
      console.error("[file-processing-recovery] failed");
    }
  }
}
