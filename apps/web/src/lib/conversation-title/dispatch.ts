import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getQueue } from "@/lib/infra/queue";
import { CONVERSATION_TITLE_QUEUE } from "@/lib/jobs/catalog";

const DATABASE_NOW = sql`now()`;
const NEXT_DISPATCH_AT = sql`now() + interval '15 minutes'`;
const RECOVERY_SCAN_LIMIT = 25;

/** 原子 claim 到期任务并发送队列；业务完成前始终保留 outbox。 */
export async function dispatchConversationTitleJob(jobId: string): Promise<boolean> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [claimed] = await db
    .update(s.conversationTitleJobs)
    .set({ dispatchAfter: NEXT_DISPATCH_AT })
    .where(and(
      eq(s.conversationTitleJobs.id, jobId),
      lte(s.conversationTitleJobs.dispatchAfter, DATABASE_NOW),
    ))
    .returning({ id: s.conversationTitleJobs.id });
  if (!claimed) return false;

  const queue = await getQueue();
  await queue.send(CONVERSATION_TITLE_QUEUE, { id: String(claimed.id) });
  return true;
}

/** 顺序重投最多 25 个到期任务；单项失败不阻断同批其他任务。 */
export async function recoverConversationTitleJobs(): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const jobs = await db
    .select({ id: s.conversationTitleJobs.id })
    .from(s.conversationTitleJobs)
    .where(lte(s.conversationTitleJobs.dispatchAfter, DATABASE_NOW))
    .orderBy(
      asc(s.conversationTitleJobs.dispatchAfter),
      asc(s.conversationTitleJobs.createdAt),
    )
    .limit(RECOVERY_SCAN_LIMIT);

  for (const job of jobs) {
    try {
      await dispatchConversationTitleJob(String(job.id));
    } catch {
      console.error("[conversation-title-recovery] dispatch failed");
    }
  }
}
