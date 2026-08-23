/** mem0 客户端工厂：Embedding 与 LLM 使用独立配置，LLM 走统一模型执行核心。 */
import type { Memory } from "mem0ai/oss";
import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { resolveRoutesById } from "@/lib/routing";
import { getSettingsRevision } from "@/lib/settings-control/service";
import { createNekosoraLLM } from "./nekosora-llm";

/** Mem0 抽取的软约束；确定性角色与内容边界由调用方负责。 */
const MEMORY_EXTRACTION_INSTRUCTIONS = [
  "仅提取用户明确表达且未来仍有价值的长期信息：稳定偏好、客观事实、持续进行的项目和用户已确认的决定。",
  "忽略标题、标签、寒暄、澄清请求、一次性请求、工具或搜索输出、助手推测、助手建议及其他仅由助手表达的内容。",
  "不得把助手消息或模型生成内容归因为用户；没有符合条件的信息时不要创建记忆。",
].join("\n");

let _memory: Memory | null = null;
let _initPromise: Promise<Memory> | null = null;
let _modelFingerprint: string | null = null;
let _settingsRevision: number | null = null;

type ModelReference = { modelId: string; modelName: string };

async function modelByName(name: string): Promise<ModelReference | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db
    .select({ id: s.models.id, name: s.models.name })
    .from(s.models)
    .where(and(eq(s.models.name, name), eq(s.models.enabled, true), eq(s.models.visibility, "public")))
    .limit(1);
  return row ? modelById(String(row.id)) : null;
}

async function modelById(id: string): Promise<ModelReference | null> {
  try {
    const routes = await resolveRoutesById(
      { userId: "", keyKind: null, source: "chat" },
      id,
    );
    const route = routes[0];
    return route ? { modelId: id, modelName: route.modelName } : null;
  } catch {
    return null;
  }
}

async function resolveConfiguredModel(): Promise<ModelReference> {
  const [{ getSetting }, { getEmbeddingConfig }] = await Promise.all([
    import("@/lib/system-settings/service"),
    import("@/lib/rag/embedding"),
  ]);
  const [modelId, modelName, titleModelId, titleModel, embedding] = await Promise.all([
    getSetting("rag", "mem0_llm_model_id"),
    getSetting("rag", "mem0_llm_model"),
    getSetting("task", "title_model_id"),
    getSetting("task", "title_model"),
    getEmbeddingConfig(),
  ]);
  if (!embedding) throw new Error("mem0 初始化失败:未配置 embedding provider/model(rag.embedding_*)");

  const candidates: Array<Promise<ModelReference | null>> = [];
  if (modelId) candidates.push(modelById(modelId));
  if (modelName) candidates.push(modelByName(modelName));
  if (titleModelId) candidates.push(modelById(titleModelId));
  if (titleModel) candidates.push(modelByName(titleModel));
  for (const candidate of candidates) {
    const resolved = await candidate;
    if (resolved) return resolved;
  }
  throw new Error("mem0 初始化失败:未配置可用的 mem0 抽取模型");
}

async function initialize(model: ModelReference, revision: number): Promise<Memory> {
  const [{ Memory }, { getEmbeddingConfig }] = await Promise.all([
    import("mem0ai/oss"),
    import("@/lib/rag/embedding"),
  ]);
  const emb = await getEmbeddingConfig();
  if (!emb) throw new Error("mem0 初始化失败:未配置 embedding provider/model(rag.embedding_*)");
  const memory = new Memory({
    disableHistory: true,
    customInstructions: MEMORY_EXTRACTION_INSTRUCTIONS,
    vectorStore: {
      provider: "pgvector",
      config: { connectionString: process.env.DATABASE_URL, collectionName: "mem0_memories", embeddingModelDims: 1024 },
    },
    embedder: {
      provider: "openai",
      config: { apiKey: emb.apiKey, baseURL: emb.baseUrl, model: emb.model },
    },
    llm: { provider: "langchain", config: { model: createNekosoraLLM(model) } },
  });
  _memory = memory;
  _modelFingerprint = `${model.modelId}:${model.modelName}`;
  _settingsRevision = revision;
  return memory;
}

/** 普通召回/CRUD 复用客户端；抽取传 refreshModel=true 以跨 worker 进程刷新配置。 */
export async function getMemory(options?: { refreshModel?: boolean }): Promise<Memory> {
  const revision = await getSettingsRevision();
  if (!options?.refreshModel && _memory && _settingsRevision === revision) return _memory;
  const model = await resolveConfiguredModel();
  const fingerprint = `${model.modelId}:${model.modelName}`;
  if (_memory && _modelFingerprint === fingerprint && _settingsRevision === revision) return _memory;
  if (_initPromise) {
    // 配置在初始化窗口内变化时，先等待旧 client，再按新指纹重建。
    await _initPromise.catch(() => undefined);
    if (_memory && _modelFingerprint === fingerprint && _settingsRevision === revision) return _memory;
  }
  _initPromise = initialize(model, revision).catch((error) => {
    _initPromise = null;
    throw error;
  });
  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
}

export function resetMemoryClient(): void {
  _memory = null;
  _initPromise = null;
  _modelFingerprint = null;
  _settingsRevision = null;
}
