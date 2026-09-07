"use server";

import { refreshSettings } from "./refresh-settings";
import { getDb } from "@/lib/infra/db";
import { requireOwnedProvider } from "@/lib/providers/ownership";
import { requireAdmin } from "@/lib/session";
import {
  saveSystemSettings,
} from "@/lib/settings-control/service";

/** 保存系统级 Embedding Provider 与模型配置。 */
export async function saveEmbedding(
  expected: number,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();
  const providerId = String(formData.get("provider_id") ?? "");
  const model = String(formData.get("model") ?? "").trim();
  if (providerId) {
    const db = await getDb();
    await requireOwnedProvider(db, providerId, admin.id);
  }
  const saved = await saveSystemSettings({
    actorId: admin.id,
    expected,
    namespace: "rag",
    values: { embedding_provider_id: providerId, embedding_model: model },
  });
  await refreshSettings(saved);
}
