/**
 * Chat 上下文准备 —— WebChat 流式生成前的「段 A」。
 *
 * 把原始 messages + 各种会话级开关，加工成最终发给 streamChat 的 IRRequest，
 * 并产出 process_trace 与流式首帧需要的元数据(RAG 状态 / 联网结果 / 压缩信息)。
 *
 * 设计:纯输入→输出,与流式执行(段 B/C,在 route.ts 的 ReadableStream 内)无耦合,
 * 是 route.ts 唯一干净的拆分边界。失败兜底策略与原内联实现逐行对齐。
 */
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { IRRequest } from "@/lib/providers/types";
import type { ProcessTrace } from "@/db/types";
import { getFileIdsByKnowledgeBases } from "@/lib/knowledge-base/service";
import { buildMultimodalUserMessage } from "@/lib/multimodal/assemble";
import { buildMessagesWithFileContext } from "@/lib/rag/context";
import { searchWeb, renderSearchContext } from "@/lib/web-search/service";
import type { SearchBundle } from "@/lib/web-search/types";
import { getMemories } from "@/lib/memory/service";
import { recallMemories } from "@/lib/memory/recall";
import { maybeCompact, type CompactionResult } from "@/lib/compact/service";
import { getOutputMode } from "@/lib/output-modes/service";
import { getTemplate, renderTemplate, incUseCount as incTplUseCount } from "@/lib/templates/service";
import { getCardsByIds, renderCardContext, incUseCount as incCardUseCount } from "@/lib/instruction-cards/service";
import { assembleContext } from "@/lib/context-assembler";
import { buildTrace } from "@/lib/trace";

/** route 已建立的 DB 连接与 schema(透传,避免重复 getDb)。 */

export interface PrepareContextInput {
  userId: string;
  conversationId: string;
  /** 会话行(仅取 outputModeId)。 */
  conv: { outputModeId: string | null };
  /** 本轮用户原文(取最后一条 user 消息,用于 RAG query / 搜索 / 召回)。 */
  userContent: string;
  /** 目标模型名(来自请求体 body.model)。 */
  model: string;
  /** 目标模型 id(WebChat byId;vision 校验优先用 id 避免重名歧义)。 */
  modelId?: string;
  /** 原始 messages(会被 RAG / vision 改写)。 */
  messages: IRRequest["messages"];
  /** 附件 fileIds。 */
  fileIds?: string[];
  /** 挂载的知识库 ID。 */
  knowledgeBaseIds?: string[];
  /** 联网搜索开关。 */
  webSearch?: boolean;
  /** Prompt 模板 ID + 变量。 */
  templateId?: string;
  templateVars?: Record<string, string>;
  /** 指令卡 ID 列表。 */
  instructionCardIds?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
}

export interface PrepareContextResult {
  irRequest: IRRequest;
  trace: ProcessTrace;
  searchBundle: SearchBundle | null;
  ragStatus: string | null;
  compaction: CompactionResult | null;
  /** 压缩前的 DB 消息总数(沿当前分支),供 trace 的 originalMessageCount。 */
  originalMessageCount: number;
}

/**
 * 准备上下文。失败不抛出(各阶段均有兜底),仅 vision 校验失败时返回 error 供 route 提前 400。
 * 严格对齐原 route.ts 122-308 行的执行顺序与兜底策略。
 */
export async function prepareChatContext(
  input: PrepareContextInput,
): Promise<PrepareContextResult | { error: NextResponse }> {
  const {
    userId, conversationId, conv, userContent, model, modelId, messages,
    fileIds: bodyFileIds, knowledgeBaseIds, webSearch: webSearchOn,
    templateId, templateVars, instructionCardIds,
    db, schema: s,
  } = input;

  let effectiveMessages = messages;
  let ragStatus: string | null = null;

  // ===== 知识库 fileIds 合并 =====
  let fileIds = bodyFileIds ?? [];
  if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
    const kbFileIds = await getFileIdsByKnowledgeBases(knowledgeBaseIds);
    fileIds = [...new Set([...fileIds, ...kbFileIds])];
  }

  // ===== vision 图片附件分离 =====
  let imageFileIds: string[] = [];
  if (fileIds.length > 0) {
    const fileRows = await db
      .select({ id: s.fileObjects.id, mime: s.fileObjects.mime })
      .from(s.fileObjects)
      .where(inArray(s.fileObjects.id, fileIds));
    imageFileIds = fileRows
      .filter((r: { mime: string }) => (r.mime as string).startsWith("image/"))
      .map((r: { id: string }) => r.id);
  }

  if (imageFileIds.length > 0) {
    // WebChat 可见性:public ∪ (private && owner=自己)。
    // 优先 by id(无重名歧义);缺省回退 by name。
    const [modelRow] = modelId
      ? await db
          .select()
          .from(s.models)
          .where(
            and(
              eq(s.models.id, modelId),
              eq(s.models.enabled, true),
              or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, userId)),
            ),
          )
          .limit(1)
      : await db
          .select()
          .from(s.models)
          .where(
            and(
              eq(s.models.name, model),
              eq(s.models.enabled, true),
              or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, userId)),
            ),
          )
          .limit(1);
    const caps = modelRow?.capabilities as { vision?: boolean } | undefined;
    if (!caps?.vision) {
      return {
        error: NextResponse.json(
          { error: "当前模型不支持图片输入(需 capabilities.vision=true)" },
          { status: 400 },
        ),
      };
    }
    const lastUserIdx = effectiveMessages.length - 1;
    if (lastUserIdx >= 0) {
      const lastContent =
        typeof effectiveMessages[lastUserIdx].content === "string"
          ? (effectiveMessages[lastUserIdx].content as string)
          : userContent;
      effectiveMessages[lastUserIdx] = await buildMultimodalUserMessage(lastContent, imageFileIds);
    }
  }

  if (fileIds.length > 0) {
    // 读取用户 file_mode 设置(默认 auto)
    const [modeRow] = await db
      .select()
      .from(s.userSettings)
      .where(and(eq(s.userSettings.userId, userId), eq(s.userSettings.key, "chat.file_mode")))
      .limit(1);
    const fileMode = (modeRow?.value as string) ?? "auto";

    const built = await buildMessagesWithFileContext({
      messages: messages,
      fileIds,
      fileMode: fileMode as "auto" | "full_context" | "rag",
      query: userContent,
    });
    effectiveMessages = built.messages as IRRequest["messages"];
    ragStatus = built.ragStatus;
  }

  // ===== 联网搜索(可选)=====
  let searchBundle: SearchBundle | null = null;
  if (webSearchOn) {
    searchBundle = await searchWeb(userContent);
  }

  // ===== 长期记忆 + 上下文压缩 =====
  // preference + profile 恒定注入(getMemories 全量);project 走召回(语义+关键词兜底)
  const allMemories = await getMemories(userId).catch(() => []);
  let recalledMemories: typeof allMemories = [];
  try {
    recalledMemories = await recallMemories(userId, userContent);
  } catch {
    /* 召回失败:project 不注入,不影响恒定注入 */
  }

  // 读取已有消息(沿当前分支),供压缩的 CoveragePathHash
  const existingMsgs = await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt);
  const compactionMsgs = (existingMsgs as Record<string, unknown>[]).map((m) => ({
    id: m.id as string,
    publicId: m.publicId as string,
    parentId: (m.parentId as string) ?? null,
    role: m.role as string,
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
  }));
  let compaction: CompactionResult | null = null;
  try {
    compaction = await maybeCompact(conversationId, compactionMsgs);
  } catch (err) {
    console.warn("[chat] 压缩失败,跳过:", err);
  }

  // ===== 会话级 output mode system prompt =====
  let outputModePrompt: string | null = null;
  if (conv.outputModeId) {
    const mode = await getOutputMode(conv.outputModeId).catch(() => null);
    if (mode?.enabled && mode.systemPrompt) {
      outputModePrompt = mode.systemPrompt;
    }
  }

  // ===== Prompt 模板(若指定)=====
  let templateSystemPrompt: string | null = null;
  if (templateId) {
    const tpl = await getTemplate({ userId }, templateId);
    if (tpl) {
      const rendered = renderTemplate(tpl, templateVars ?? {});
      templateSystemPrompt = rendered.systemPrompt;
      // 若模板有 userTemplate,替换最后一条 user 消息内容。
      if (rendered.userMessage && effectiveMessages.length > 0) {
        const lastIdx = effectiveMessages.length - 1;
        effectiveMessages[lastIdx] = {
          ...effectiveMessages[lastIdx],
          content: rendered.userMessage,
        };
      }
      incTplUseCount(tpl.id).catch(() => {}); // 异步计数,不阻塞
    }
  }

  // ===== 指令卡(若指定)=====
  let cardSystemPrompt: string | null = null;
  if (instructionCardIds && instructionCardIds.length > 0) {
    const cards = await getCardsByIds(userId, instructionCardIds);
    cardSystemPrompt = renderCardContext(cards);
    if (cards.length > 0) {
      incCardUseCount(cards.map((c) => c.id)).catch(() => {}); // 异步计数
    }
  }

  // ===== 合并 system 来源(output_mode + template + card + web_search)=====
  let searchContext: string | null = null;
  if (searchBundle?.hit) {
    searchContext = renderSearchContext(searchBundle.results);
  }
  const extraSystemParts = [outputModePrompt, templateSystemPrompt, cardSystemPrompt, searchContext].filter(
    (p): p is string => p !== null,
  );
  const mergedSystemPrompt =
    extraSystemParts.length > 0 ? extraSystemParts.join("\n\n") : null;

  // ===== 槽位组装 =====
  const assembled = assembleContext({
    messages: effectiveMessages as { role: string; content: string | unknown[] }[],
    memories: allMemories,
    recalledMemories,
    compaction,
    fileContext: null, // RAG 已在上一步直接注入到 messages
    templateSystemPrompt: mergedSystemPrompt,
    maxTokens: 32000,
  });

  const trace = buildTrace(assembled, compactionMsgs.length);

  const irRequest: IRRequest = {
    model,
    messages: assembled as IRRequest["messages"],
    stream: true,
    max_tokens: 16384,
  };

  return {
    irRequest,
    trace,
    searchBundle,
    ragStatus,
    compaction,
    originalMessageCount: compactionMsgs.length,
  };
}
