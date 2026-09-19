"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, getSchema } from "@nekusora/core/infra/db";
import { requireAdmin } from "@/lib/session";
import type { ModelCapabilities } from "@nekusora/db/types";

/** 目录能力全局共享；仅更新图像生成标记，避免覆盖同步写入的其他能力。 */
export async function setCatalogImageGeneration(catalogId: string, enabled: boolean, format?: ModelCapabilities["imageGenerationFormat"]) {
  await requireAdmin();
  const input = z.object({ catalogId: z.string().trim().min(1), enabled: z.boolean(),
    format: z.enum(["openai-images", "openai-responses"]).optional() })
    .parse({ catalogId, enabled, format });
  const db = await getDb();
  const { modelCatalog } = getSchema();
  const [updated] = await db.update(modelCatalog).set({
    capabilities: sql`${modelCatalog.capabilities} || ${JSON.stringify({ imageGeneration: input.enabled,
      ...(input.format ? { imageGenerationFormat: input.format } : {}),
    })}::jsonb`,
    updatedAt: sql`now()`,
  }).where(eq(modelCatalog.id, input.catalogId)).returning({ id: modelCatalog.id });
  if (!updated) throw new Error("MODEL_CATALOG_NOT_FOUND");
  revalidatePath("/panel/models");
  revalidatePath("/admin/models");
  revalidatePath("/image");
  revalidatePath("/chat", "layout");
}
