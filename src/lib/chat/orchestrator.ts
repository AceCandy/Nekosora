/**
 * Chat 上下文准备 —— WebChat 流式生成前的「段 A」。
 *
 * 把原始 messages + 各种会话级开关，加工成最终发给 streamChat 的 IRRequest，
 * 并产出 process_trace 与流式首帧需要的元数据(RAG 状态 / 联网结果 / 压缩信息)。
 *
 * 设计:纯输入→输出,与流式执行(段 B/C,在 route.ts 的 ReadableStream 内)无耦合,
 * 是 route.ts 唯一干净的拆分边界。失败兜底策略与原内联实现逐行对齐。
 *
 * 执行模型:三阶段 —— ① fileIds 合并(前置,vision/RAG 强依赖)
 *   ② 无依赖耗时步 Promise.all 并行(联网搜索/记忆/压缩/output mode/模板/指令卡 + fileIds 链)
 *   ③ assemble 后置(等齐全部)。并行后各步兜底行为与 trace 产出与原串行实现等价。
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
 * 准备上下文。各阶段均有兜底(搜索/召回/压缩/output mode 降级),仅 vision 校验失败返回 error。
 * 无依赖耗时步并行,降首字延迟;兜底行为与 trace 产出与原串行实现等价。
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

  // ===== 阶段 1:知识库 fileIds 合并(后续 vision/RAG 链强依赖,先算)=====
  let fileIds = bodyFileIds ?? [];
  if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
    const kbFileIds = await getFileIdsByKnowledgeBases(knowledgeBaseIds, userId);
    fileIds = [...new Set([...fileIds, ...kbFileIds])];
  }

  // ===== 阶段 2:无依赖耗时步并行 =====
  // 各分支保留原兜底:降级项自带 catch(resolve 降级值);冒泡项(searchWeb/getTemplate/getCardsByIds)
  // 失败 → Promise.all reject → 与原串行版"中途抛错"语义一致。
  const [
    fileChain, searchBundle, memoryResult, compactionResult,
    outputModePrompt, templateResult, cardSystemPrompt,
  ] = await Promise.all([
    // 分支 A:fileIds 依赖链(vision 分离 → 能力校验 → multimodal → file_mode → RAG),内部有序
    (async (): Promise<
      | { ok: true; effectiveMessages: IRRequest["messages"]; ragStatus: string | null }
      | { ok: false; error: NextResponse }
    > => {
      let effectiveMessages = messages;
      let ragStatus: string | null = null;

      // vision 图片附件分离
      let imageFileIds: string[] = [];
      if (fileIds.length > 0) {
        const fileRows = await db
          .select({ id: s.fileObjects.id, mime: s.fileObjects.mime })
          .from(s.fileObjects)
          .where(
            and(
              inArray(s.fileObjects.id, fileIds),
              eq(s.fileObjects.userId, userId),
            ),
          );
        imageFileIds = fileRows
          .filter((r: { mime: string }) => (r.mime as string).startsWith("image/"))
          .map((r: { id: string }) => r.id);
      }

      if (imageFileIds.length > 0) {
        // WebChat 可见性:public ∪ (private && owner=自己)。优先 by id;缺省回退 by name。
        const [modelRow] = modelId
          ? await db
              .select({ capabilities: s.modelCatalog.capabilities })
              .from(s.models)
              .innerJoin(s.modelCatalog, eq(s.models.catalogId, s.modelCatalog.id))
              .where(
                and(
                  eq(s.models.id, modelId),
                  eq(s.models.enabled, true),
                  or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, userId)),
                ),
              )
              .limit(1)
          : await db
              .select({ capabilities: s.modelCatalog.capabilities })
              .from(s.models)
              .innerJoin(s.modelCatalog, eq(s.models.catalogId, s.modelCatalog.id))
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
            ok: false,
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
          effectiveMessages[lastUserIdx] = await buildMultimodalUserMessage(
            lastContent,
            imageFileIds,
            userId,
          );
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
          userId,
          messages: messages,
          fileIds,
          fileMode: fileMode as "auto" | "full_context" | "rag",
          query: userContent,
        });
        effectiveMessages = built.messages as IRRequest["messages"];
        ragStatus = built.ragStatus;
      }

      return { ok: true, effectiveMessages, ragStatus };
    })(),

    // 分支 B:联网搜索(失败冒泡,保留原行为)
    webSearchOn ? searchWeb(userId, userContent) : Promise.resolve(null),

    // 分支 C:长期记忆(preference/profile 恒定注入 + project 召回)
    (async () => {
      const allMemories = await getMemories(userId).catch(() => []);
      let recalledMemories: typeof allMemories = [];
      try {
        recalledMemories = await recallMemories(userId, userContent);
      } catch {
        /* 召回失败:project 不注入,不影响恒定注入 */
      }
      return { allMemories, recalledMemories };
    })(),

    // 分支 D:已有消息查询 → 上下文压缩(顺序依赖)
    (async () => {
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
      return { compactionMsgs, compaction };
    })(),

    // 分支 E:会话级 output mode system prompt
    (async (): Promise<string | null> => {
      if (!conv.outputModeId) return null;
      const mode = await getOutputMode(conv.outputModeId).catch(() => null);
      if (mode?.enabled && mode.systemPrompt) return mode.systemPrompt;
      return null;
    })(),

    // 分支 F:Prompt 模板(systemPrompt + userMessage)
    // userMessage 应用延后到阶段 3(在 vision/RAG 之后),保持原顺序:template 覆盖 vision 的 multimodal。
    (async (): Promise<{ systemPrompt: string | null; userMessage: string | null }> => {
      if (!templateId) return { systemPrompt: null, userMessage: null };
      const tpl = await getTemplate({ userId }, templateId);
      if (!tpl) return { systemPrompt: null, userMessage: null };
      const rendered = renderTemplate(tpl, templateVars ?? {});
      incTplUseCount(tpl.id).catch(() => {}); // 异步计数,不阻塞
      return { systemPrompt: rendered.systemPrompt ?? null, userMessage: rendered.userMessage ?? null };
    })(),

    // 分支 G:指令卡
    (async (): Promise<string | null> => {
      if (!instructionCardIds || instructionCardIds.length === 0) return null;
      const cards = await getCardsByIds(userId, instructionCardIds);
      if (cards.length > 0) {
        incCardUseCount(cards.map((c) => c.id)).catch(() => {}); // 异步计数
      }
      return renderCardContext(cards);
    })(),
  ]);

  // ===== 阶段 3:后置串行(等齐全部并行结果)=====
  // vision 校验失败 → 提前返回 400(保留原行为)
  if (!fileChain.ok) return { error: fileChain.error };
  let effectiveMessages = fileChain.effectiveMessages;
  const ragStatus = fileChain.ragStatus;

  // template 的 userMessage 覆盖最后一条 user(在 vision/RAG 之后,保持原顺序)
  if (templateResult.userMessage && effectiveMessages.length > 0) {
    const lastIdx = effectiveMessages.length - 1;
    effectiveMessages = [...effectiveMessages];
    effectiveMessages[lastIdx] = {
      ...effectiveMessages[lastIdx],
      content: templateResult.userMessage,
    };
  }

  // 合并 system 来源(output_mode + template + card + web_search)
  let searchContext: string | null = null;
  if (searchBundle?.hit) {
    searchContext = renderSearchContext(searchBundle.results);
  }
  const extraSystemParts = [outputModePrompt, templateResult.systemPrompt, cardSystemPrompt, searchContext].filter(
    (p): p is string => p !== null,
  );
  const mergedSystemPrompt =
    extraSystemParts.length > 0 ? extraSystemParts.join("\n\n") : null;

  // 槽位组装
  const assembled = assembleContext({
    messages: effectiveMessages as { role: string; content: string | unknown[] }[],
    memories: memoryResult.allMemories,
    recalledMemories: memoryResult.recalledMemories,
    compaction: compactionResult.compaction,
    fileContext: null, // RAG 已在分支 A 直接注入到 messages
    templateSystemPrompt: mergedSystemPrompt,
    maxTokens: 32000,
  });

  const trace = buildTrace(assembled, compactionResult.compactionMsgs.length);

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
    compaction: compactionResult.compaction,
    originalMessageCount: compactionResult.compactionMsgs.length,
  };
}
