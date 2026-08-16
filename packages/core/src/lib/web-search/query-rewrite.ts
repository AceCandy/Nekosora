import { generateChat } from "@/lib/stream";
import type { CallContext } from "@/lib/providers/types";
import { listWebSearchQueryModelCandidates, loadConfig } from "./registry";

const REWRITE_INPUT_LIMIT = 4_000;
const REWRITE_OUTPUT_LIMIT = 500;

/** 用用户配置的普通模型把长问题压缩成一条搜索查询；不可用时返回 null 让调用方回退原文。 */
export async function rewriteSearchQuery(input: {
  userId: string;
  userContent: string;
  ctx: CallContext;
  runId: string;
  signal: AbortSignal;
}): Promise<string | null> {
  input.signal.throwIfAborted();
  const config = await loadConfig(input.userId);
  const modelId = config?.queryRewriteModelId;
  if (!modelId) return null;

  const model = (await listWebSearchQueryModelCandidates(input.userId))
    .find((candidate) => candidate.id === modelId);
  if (!model) return null;

  const result = await generateChat({
    ctx: input.ctx,
    modelId: model.id,
    request: {
      model: model.name,
      messages: [
        {
          role: "system",
          content: "将用户问题改写为一条适合搜索引擎的查询。保留专有名词、版本号、错误信息和时间范围。只输出查询本身，不要解释、引号或 Markdown。",
        },
        { role: "user", content: input.userContent.slice(0, REWRITE_INPUT_LIMIT) },
      ],
      temperature: 0,
      max_tokens: 128,
    },
    runId: `${input.runId}:search-query`,
    taskKind: "web_search_query",
    abortSignal: input.signal,
  });
  input.signal.throwIfAborted();
  if (result.error || !result.text) return null;

  const query = result.text
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/, 1)[0]
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim()
    .slice(0, REWRITE_OUTPUT_LIMIT);
  return query || null;
}
