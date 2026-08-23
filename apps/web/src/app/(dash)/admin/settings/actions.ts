"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/infra/db";
import { requireOwnedProvider } from "@/lib/providers/ownership";
import { requireAdmin } from "@/lib/session";
import {
  stageSystemSettings,
  type SettingsDraftExpectation,
} from "@/lib/settings-control/service";

/** 保存系统级 Embedding Provider 与模型配置。 */
export async function saveEmbedding(
  expected: SettingsDraftExpectation,
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();
  const providerId = String(formData.get("provider_id") ?? "");
  const model = String(formData.get("model") ?? "").trim();
  if (providerId) {
    const db = await getDb();
    await requireOwnedProvider(db, providerId, admin.id);
  }
  await stageSystemSettings({
    actorId: admin.id,
    expected,
    namespace: "rag",
    values: { embedding_provider_id: providerId, embedding_model: model },
  });
  revalidatePath("/admin/settings");
}
