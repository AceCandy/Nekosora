import { generateChat } from "@/lib/stream";
import type { CallContext } from "@/lib/providers/types";
import { listWebSearchQueryModelCandidates, loadConfig } from "./registry";

const REWRITE_INPUT_LIMIT = 4_000;
const REWRITE_CONTEXT_LIMIT = 3_000;
const REWRITE_OUTPUT_LIMIT = 500;
const CHAT_TIME_ZONE = "Asia/Shanghai";
const REFUSAL_QUERY = /^(?:抱歉|对不起|很抱歉|sorry\b|i (?:can(?:not|'t)|am unable)\b)/i;

/** 用用户配置的普通模型把长问题压缩成一条搜索查询；不可用时返回 null 让调用方回退原文。 */
export async function rewriteSearchQuery(input: {
  userId: string;
  userContent: string;
  context?: string;
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
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHAT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: CHAT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const now = new Date();
  const currentDate = dateFormatter.format(now);
  const currentTime = timeFormatter.format(now);

  const rewriteInput = input.context
    ? `对话上下文（仅用于理解指代，不要直接照抄）：\n${input.context.slice(-REWRITE_CONTEXT_LIMIT)}\n\n当前用户问题：\n${input.userContent.slice(0, REWRITE_INPUT_LIMIT)}`
    : input.userContent.slice(0, REWRITE_INPUT_LIMIT);
  const result = await generateChat({
    ctx: input.ctx,
    modelId: model.id,
    request: {
      model: model.name,
      messages: [
        {
          role: "system",
          content: `将用户问题改写为一条适合搜索引擎的查询。当前日期是 ${currentDate}，当前时间是 ${currentTime}，时区是 ${CHAT_TIME_ZONE}。遇到今天、最新、近期等相对时间时，以此时间为准；“最新”对应最近一周，“最近/近期”对应最近一个月，“今天”可保留当天日期。禁止根据“最近/最新”自行添加用户未指定的历史年份或宽泛年份范围。保留专有名词、版本号、错误信息和用户明确给出的时间范围。只输出查询本身，不要回答问题、拒绝请求、解释、添加引号或 Markdown。`,
        },
        { role: "user", content: rewriteInput },
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
  return query && !REFUSAL_QUERY.test(query) ? query : null;
}
