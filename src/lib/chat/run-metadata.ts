import { and, eq, inArray } from "drizzle-orm";
import type { MessageRunMetadata } from "@/features/chat/model/types";

/** 按 runId 批量加载当前会话的可公开运行元数据。 */
export async function loadRunMetadataByRunIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  conversationId: string,
  runIds: string[],
): Promise<Map<string, MessageRunMetadata>> {
  const byRunId = new Map<string, MessageRunMetadata>();
  if (runIds.length === 0) return byRunId;

  const rows = (await db
    .select({
      runId: s.runs.runId,
      model: s.runs.platformModelName,
      tokenUsage: s.runs.tokenUsage,
      durationMs: s.runs.durationMs,
      completedAt: s.runs.completedAt,
    })
    .from(s.runs)
    .where(
      and(
        eq(s.runs.conversationId, conversationId),
        inArray(s.runs.runId, runIds),
      ),
    )) as Array<{
    runId: string;
    model: string | null;
    tokenUsage: MessageRunMetadata["tokenUsage"] | null;
    durationMs: number | null;
    completedAt: Date | null;
  }>;

  for (const row of rows) {
    const metadata: MessageRunMetadata = {};
    if (row.model) metadata.model = row.model;
    if (row.tokenUsage != null) metadata.tokenUsage = row.tokenUsage;
    if (row.durationMs != null) metadata.durationMs = row.durationMs;
    if (row.completedAt) metadata.completedAt = row.completedAt.toISOString();
    if (Object.keys(metadata).length > 0) byRunId.set(row.runId, metadata);
  }
  return byRunId;
}
