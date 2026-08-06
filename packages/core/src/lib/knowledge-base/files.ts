import { and, eq, inArray } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";

/** 收集当前用户知识库下全部可检索文件。 */
export async function getFileIdsByKnowledgeBases(
  kbIds: string[],
  userId: string,
): Promise<string[]> {
  if (kbIds.length === 0) return [];
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = getSchema() as any;
  const rows = await db
    .select({ id: schema.fileObjects.id })
    .from(schema.fileObjects)
    .where(
      and(
        inArray(schema.fileObjects.knowledgeBaseId, kbIds),
        eq(schema.fileObjects.userId, userId),
        eq(schema.fileObjects.ragReady, true),
      ),
    );
  return rows.map((row: { id: string }) => row.id);
}
