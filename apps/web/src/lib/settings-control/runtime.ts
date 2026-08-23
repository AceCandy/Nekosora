import { resetCompactModelConfig } from "@/lib/compact/service";
import { resetTitleModelConfig } from "@/lib/conversation-title/service";
import { resetMemoryClient } from "@/lib/memory/mem0";
import { resetEmbeddingConfig } from "@/lib/rag/embedding";
import { resetUAConfig } from "@/lib/system-settings/ua";
import { invalidateOutputModesCache } from "@/lib/output-modes/service";
import { invalidateRenderStylesCache } from "@/lib/render-styles/service";

/** 只在发布事务提交后调用；revision 检查保证跨进程下一次读取收敛。 */
export async function invalidateSettingsRuntime(previousRevision: number): Promise<boolean> {
  resetUAConfig();
  resetEmbeddingConfig();
  resetTitleModelConfig();
  resetCompactModelConfig();
  resetMemoryClient();
  const results = await Promise.allSettled([
    invalidateOutputModesCache(previousRevision),
    invalidateRenderStylesCache(previousRevision),
  ]);
  return results.some((result) => result.status === "rejected");
}
