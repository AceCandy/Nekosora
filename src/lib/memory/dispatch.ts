import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getQueue } from "@/lib/infra/queue";
import { redactErrorMessage } from "@/lib/redaction";

const DATABASE_NOW = sql`now()`;
const NEXT_DISPATCH_AT = sql`now() + interval '15 minutes'`;
const RECOVERY_SCAN_LIMIT = 25;
const RECOVERY_INTERVAL_MS = 60_000;

/** 原子 claim 到期 intent 并发送 job id；业务完成前不删除 durable row。 */
export async function dispatchMemoryExtractionJob(jobId: string): Promise<boolean> {
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

  const queue = await getQueue();
  await queue.send("memory-extract", { id: String(claimed.id) });
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
    } catch (error) {
      console.error(
        `[memory-extraction-recovery] dispatch failed for ${String(job.id)}:`,
        redactErrorMessage(error, [], "记忆提取任务投递失败").slice(0, 200),
      );
    }
  }
}

/** 启动立即执行且单飞的恢复扫描，停止时等待当前扫描完成。 */
export function startMemoryExtractionRecovery(
  recover: () => Promise<void> = recoverMemoryExtractionJobs,
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const run = () => {
    if (stopped || inFlight) return;
    const pending = Promise.resolve()
      .then(recover)
      .catch((error) => {
        console.error(
          "[memory-extraction-recovery] scan failed:",
          redactErrorMessage(error, [], "记忆提取恢复扫描失败").slice(0, 200),
        );
      });
    inFlight = pending;
    void pending.finally(() => {
      if (inFlight === pending) inFlight = null;
    });
  };

  run();
  const timer = setInterval(run, RECOVERY_INTERVAL_MS);
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
