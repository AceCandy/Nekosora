/**
 * mem0 客户端工厂 -- 复用本库 PG(pgvector)+ 管理员配的 embedding/LLM 上游。
 *
 * mem0 全权负责记忆抽取 + consolidation(add 时 infer=true):
 *   - vectorStore: pgvector,复用 DATABASE_URL,collectionName=mem0_memories,1024 维
 *   - embedder: openai 兼容(bge-m3,经 rag.embedding_* 上游),embeddingDims=1024
 *   - llm: openai 兼容,复用 embedding 上游连接 + rag.mem0_llm_model(回退 task.title_model)
 * per-user 隔离:add/search 传 userId;scope/disclosure/priority 存 metadata(M-3)。
 *
 * 惰性初始化(仿 getDb),动态 import mem0ai/oss,避免 Edge/instrumentation 打包。
 */
import type { Memory } from "mem0ai/oss";

let _memory: Memory | null = null;
let _initPromise: Promise<Memory> | null = null;

/** 获取 mem0 客户端(惰性初始化,in-flight guard 防并发 double-init)。 */
export async function getMemory(): Promise<Memory> {
  if (_memory) return _memory;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const [{ Memory }, { getEmbeddingConfig }, { getSetting }] = await Promise.all([
      import("mem0ai/oss"),
      import("@/lib/rag/embedding"),
      import("@/lib/system-settings/service"),
    ]);
    const emb = await getEmbeddingConfig();
    if (!emb) throw new Error("mem0 初始化失败:未配置 embedding provider/model(rag.embedding_*)");
    // LLM 复用 embedding 上游连接(OpenAI 兼容直连);model 优先 mem0_llm_model,回退 title_model
    const llmModel =
      (await getSetting("rag", "mem0_llm_model")) || (await getSetting("task", "title_model"));
    if (!llmModel) {
      throw new Error("mem0 初始化失败:未配置 mem0 抽取模型(rag.mem0_llm_model 或 task.title_model)");
    }

    const memory = new Memory({
      vectorStore: {
        provider: "pgvector",
        config: {
          connectionString: process.env.DATABASE_URL,
          collectionName: "mem0_memories",
          embeddingModelDims: 1024,
        },
      },
      embedder: {
        provider: "openai",
        config: {
          apiKey: emb.apiKey,
          baseURL: emb.baseUrl,
          model: emb.model,
          embeddingDims: 1024,
        },
      },
      llm: {
        provider: "openai",
        config: {
          apiKey: emb.apiKey,
          baseURL: emb.baseUrl,
          model: llmModel,
        },
      },
    });
    _memory = memory;
    return memory;
  })().catch((e) => {
    // init 失败清掉 in-flight 标记,否则后续调用一直拿到 rejected promise。
    _initPromise = null;
    throw e;
  });
  return _initPromise;
}

/** 重置 mem0 客户端缓存(配置变更后调用)。 */
export function resetMemoryClient(): void {
  _memory = null;
  _initPromise = null;
}
