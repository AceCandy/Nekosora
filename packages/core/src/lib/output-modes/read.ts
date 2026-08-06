import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";

export interface OutputMode {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  icon: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** 读取单个输出模式；调用方负责请求级鉴权。 */
export async function getOutputMode(id: string): Promise<OutputMode | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db.select().from(s.outputModes).where(eq(s.outputModes.id, id)).limit(1);
  return (row as OutputMode | undefined) ?? null;
}
