import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getQueue } from "@/lib/infra/queue";
import { redactErrorMessage } from "@/lib/redaction";
import type { ConversationTitleJob } from "./service";

const DATABASE_NOW = sql`now()`;
const NEXT_DISPATCH_AT = sql`now() + interval '15 minutes'`;
const RECOVERY_SCAN_LIMIT = 25;
const RECOVERY_INTERVAL_MS = 60_000;

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
    .returning({
      id: s.conversationTitleJobs.id,
      userId: s.conversationTitleJobs.userId,
      conversationId: s.conversationTitleJobs.conversationId,
      firstUserMessage: s.conversationTitleJobs.firstUserMessage,
      fallbackTitle: s.conversationTitleJobs.fallbackTitle,
      chatModel: s.conversationTitleJobs.chatModel,
      chatModelId: s.conversationTitleJobs.chatModelId,
    });
  if (!claimed) return false;

  const queue = await getQueue();
  await queue.send("conversation-title", toConversationTitleJob(claimed));
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
    } catch (error) {
      console.error(
        `[conversation-title-recovery] dispatch failed for ${String(job.id)}:`,
        redactErrorMessage(error, [], "会话标题任务投递失败").slice(0, 200),
      );
    }
  }
}

/** 启动立即执行且单飞的恢复扫描，停止时等待当前扫描完成。 */
export function startConversationTitleRecovery(
  recover: () => Promise<void> = recoverConversationTitleJobs,
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const run = () => {
    if (stopped || inFlight) return;
    const pending = Promise.resolve()
      .then(recover)
      .catch((error) => {
        console.error(
          "[conversation-title-recovery] scan failed:",
          redactErrorMessage(error, [], "会话标题恢复扫描失败").slice(0, 200),
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

function toConversationTitleJob(row: Record<string, unknown>): ConversationTitleJob {
  return {
    id: String(row.id),
    userId: String(row.userId),
    conversationId: String(row.conversationId),
    firstUserMessage: String(row.firstUserMessage),
    fallbackTitle: String(row.fallbackTitle),
    ...(row.chatModel ? { chatModel: String(row.chatModel) } : {}),
    ...(row.chatModelId ? { chatModelId: String(row.chatModelId) } : {}),
  };
}
