import {
  CONVERSATION_TITLE_QUEUE,
  FILE_PROCESS_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  type JobOutcome,
  type QueueDefinition,
  type QueuePayload,
} from "@/lib/jobs/catalog";
import { processFile } from "@/lib/rag/processing-coordinator";
import { recoverStaleFileProcessing } from "@/lib/rag/recovery";
import { processMemoryExtractionJob } from "@/lib/memory/jobs";
import { recoverMemoryExtractionJobs } from "@/lib/memory/dispatch";
import { processConversationTitleJob } from "@/lib/conversation-title/service";
import { recoverConversationTitleJobs } from "@/lib/conversation-title/dispatch";
import type {
  RecoveryDefinition,
  WorkerDefinition,
} from "./runtime";

const RECOVERY_INTERVAL_MS = 60_000;

function defineWorker<TDefinition extends QueueDefinition<object>>(
  job: TDefinition,
  handle: (payload: QueuePayload<TDefinition>) => Promise<JobOutcome>,
  recovery: RecoveryDefinition,
): WorkerDefinition {
  return {
    job,
    handle: (payload) => handle(payload as QueuePayload<TDefinition>),
    recovery,
  };
}

/** Worker 的唯一领域装配表；顺序同时决定注册与恢复启动顺序。 */
export const WORKER_DEFINITIONS: readonly WorkerDefinition[] = Object.freeze([
  defineWorker(
    FILE_PROCESS_QUEUE,
    ({ fileId }) => processFile(fileId),
    {
      intervalMs: RECOVERY_INTERVAL_MS,
      run: recoverStaleFileProcessing,
      failureMessage: "[file-processing-recovery] scan failed",
    },
  ),
  defineWorker(
    MEMORY_EXTRACTION_QUEUE,
    ({ id }) => processMemoryExtractionJob(id),
    {
      intervalMs: RECOVERY_INTERVAL_MS,
      run: recoverMemoryExtractionJobs,
      failureMessage: "[memory-extraction-recovery] scan failed",
    },
  ),
  defineWorker(
    CONVERSATION_TITLE_QUEUE,
    ({ id }) => processConversationTitleJob(id),
    {
      intervalMs: RECOVERY_INTERVAL_MS,
      run: recoverConversationTitleJobs,
      failureMessage: "[conversation-title-recovery] scan failed",
    },
  ),
]);
