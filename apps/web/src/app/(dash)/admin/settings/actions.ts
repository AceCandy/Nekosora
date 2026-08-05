"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/infra/db";
import { resetEmbeddingConfig } from "@/lib/rag/embedding";
import { requireOwnedProvider } from "@/lib/providers/ownership";
import { requireAdmin } from "@/lib/session";
import { upsertSettings } from "@/lib/system-settings/service";

/** 保存系统级 Embedding Provider 与模型配置。 */
export async function saveEmbedding(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const providerId = String(formData.get("provider_id") ?? "");
  const model = String(formData.get("model") ?? "").trim();
  if (providerId) {
    const db = await getDb();
    await requireOwnedProvider(db, providerId, admin.id);
  }
  await upsertSettings("rag", {
    embedding_provider_id: providerId,
    embedding_model: model,
  });
  resetEmbeddingConfig();
  revalidatePath("/admin/settings");
}
