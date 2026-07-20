/**
 * Embedding 辅助 —— 解析一个 embedding 模型配置并产出向量。
 *
 * 约定:管理员在 providers 里配一个 protocol=openai 的上游,
 * 并在 system_settings(namespace="rag", key="embedding_provider_id"/"embedding_model")指定。
 * 若未配置则抛错(调用方应捕获并降级为 unavailable)。
 *
 * 维度固定 1024(bge-m3),与 schema 的 vector(1024) 一致。
 */
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { parseKeyBundle, pickWeightedKey } from "@/lib/providers/keys";
import type { Vector } from "@/lib/infra/vector";

export const EMBEDDING_DIM = 1024;

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

let _config: EmbeddingConfig | null = null;
let _configError: string | null = null;

/** 加载 embedding 配置(带缓存)。失败时 _configError 记录原因。 */
async function loadConfig(): Promise<EmbeddingConfig | null> {
  if (_config) return _config;
  if (_configError) return null;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const [providerIdRow, modelRow] = await Promise.all([
    db
      .select()
      .from(s.systemSettings)
      .where(and(eq(s.systemSettings.namespace, "rag"), eq(s.systemSettings.key, "embedding_provider_id")))
      .limit(1),
    db
      .select()
      .from(s.systemSettings)
      .where(and(eq(s.systemSettings.namespace, "rag"), eq(s.systemSettings.key, "embedding_model")))
      .limit(1),
  ]);

  const providerId = providerIdRow[0]?.value;
  const model = modelRow[0]?.value;
  if (!providerId || !model) {
    _configError = "未配置 embedding provider/model";
    return null;
  }

  const [provider] = await db.select().from(s.providers).where(eq(s.providers.id, providerId)).limit(1);
  if (!provider) {
    _configError = `embedding provider ${providerId} 不存在`;
    return null;
  }

  // 解密 api key(走统一 bundle 解析,与对话路由一致)
  let apiKey = "";
  try {
    const keys = parseKeyBundle(provider.apiKeysEnc);
    apiKey = pickWeightedKey(keys);
  } catch {
    apiKey = "";
  }

  _config = { baseUrl: provider.baseUrl, apiKey, model };
  return _config;
}

/** 重置配置缓存(配置变更后调用)。 */
export function resetEmbeddingConfig(): void {
  _config = null;
  _configError = null;
}

/** embedding 是否可用(配置就绪)。 */
export async function isEmbeddingAvailable(): Promise<boolean> {
  return (await loadConfig()) !== null;
}

/**
 * 批量生成 embedding。失败抛错。
 */
export async function embedTexts(texts: string[]): Promise<Vector[]> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error(_configError ?? "embedding 配置加载失败");

  const provider = createOpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey, name: "embedding" });
  const model = provider.embedding(cfg.model);
  const { embeddings } = await embedMany({ model, values: texts });
  return embeddings as unknown as Vector[];
}

/** 单条文本 embedding。 */
export async function embedText(text: string): Promise<Vector> {
  const [v] = await embedTexts([text]);
  return v;
}
