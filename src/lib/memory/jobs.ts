import { eq } from "drizzle-orm";
import type { MemoryExtractionMessage } from "@/db/types";
import { getDb, getSchema } from "@/lib/infra/db";
import type { JobOutcome } from "@/lib/jobs/catalog";
import { extractMemories, normalizeMemoryMessages } from "./extract";

export interface MemoryExtractionJob {
  id: string;
  runId: string;
  userId: string;
  conversationId: string;
  messages: MemoryExtractionMessage[];
}

export interface CreateMemoryExtractionJobInput {
  runId: string;
  userId: string;
  conversationId: string;
  recentMessages: readonly { role: string; content: unknown }[];
}

/** 为 completion transaction 构造最小 durable intent；不足两条时无需创建。 */
export function createMemoryExtractionJob(
  input: CreateMemoryExtractionJobInput,
): MemoryExtractionJob | null {
  const messages = normalizeMemoryMessages(input.recentMessages);
  if (messages.length < 2) return null;
  return {
    id: globalThis.crypto.randomUUID(),
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    messages,
  };
}

/** Worker 处理 durable intent；成功或明确 no-op 后删除，失败保留供重试。 */
export async function processMemoryExtractionJob(jobId: string): Promise<JobOutcome> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [job] = await db
    .select({
      id: s.memoryExtractionJobs.id,
      userId: s.memoryExtractionJobs.userId,
      conversationId: s.memoryExtractionJobs.conversationId,
      messages: s.memoryExtractionJobs.messages,
    })
    .from(s.memoryExtractionJobs)
    .where(eq(s.memoryExtractionJobs.id, jobId))
    .limit(1);
  if (!job) return "noop";

  const outcome = await extractMemories(
    String(job.userId),
    String(job.conversationId),
    job.messages as MemoryExtractionMessage[],
  );
  await db
    .delete(s.memoryExtractionJobs)
    .where(eq(s.memoryExtractionJobs.id, jobId));
  return outcome;
}
