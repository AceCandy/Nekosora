import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getQueue } from "@/lib/infra/queue";
import { MEMORY_EXTRACTION_QUEUE } from "@/lib/jobs/catalog";

const DATABASE_NOW = sql`now()`;
const NEXT_DISPATCH_AT = sql`now() + interval '15 minutes'`;
const RECOVERY_SCAN_LIMIT = 25;

/** 原子 claim 到期 intent 并发送 job id；业务完成前不删除 durable row。 */
export async function dispatchMemoryExtractionJob(jobId: string): Promise<boolean> {
  const queue = await getQueue();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [claimed] = await db
    .update(s.memoryExtractionJobs)
    .set({ dispatchAfter: NEXT_DISPATCH_AT })
    .where(and(
      eq(s.memoryExtractionJobs.id, jobId),
      lte(s.memoryExtractionJobs.dispatchAfter, DATABASE_NOW),
    ))
    .returning({ id: s.memoryExtractionJobs.id });
  if (!claimed) return false;

  await queue.send(MEMORY_EXTRACTION_QUEUE, { id: String(claimed.id) });
  return true;
}

/** 顺序重投最多 25 个到期 intent；单项失败不阻断同批其他任务。 */
export async function recoverMemoryExtractionJobs(): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const jobs = await db
    .select({ id: s.memoryExtractionJobs.id })
    .from(s.memoryExtractionJobs)
    .where(lte(s.memoryExtractionJobs.dispatchAfter, DATABASE_NOW))
    .orderBy(
      asc(s.memoryExtractionJobs.dispatchAfter),
      asc(s.memoryExtractionJobs.createdAt),
    )
    .limit(RECOVERY_SCAN_LIMIT);

  for (const job of jobs) {
    try {
      await dispatchMemoryExtractionJob(String(job.id));
    } catch {
      console.error("[memory-extraction-recovery] dispatch failed");
    }
  }
}
