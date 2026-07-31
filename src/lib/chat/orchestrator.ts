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
import { redactErrorMessage } from "@/lib/redaction";
import {
  assertVisionModel,
  type ResolvedChatImage,
} from "@/lib/chat/message-attachments";

/** 兼容默认:model_catalog 缺失时的上下文窗口与输出上限。 */
const DEFAULT_CONTEXT_WINDOW = 32_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
/** 至少为输入预留的 token,避免输出把窗口吃光。 */
const MIN_INPUT_TOKEN_BUDGET = 2_048;

/** 在模型窗口内同时为输入与输出保留正数预算。 */
export function calculateTokenBudgets(
  contextWindow: number,
  requestedMaxOutputTokens: number,
): { inputBudget: number; maxOutputTokens: number } {
  const safeContextWindow = Number.isFinite(contextWindow) && contextWindow >= 2
    ? Math.floor(contextWindow)
    : DEFAULT_CONTEXT_WINDOW;
  const safeRequestedOutput = Number.isFinite(requestedMaxOutputTokens) && requestedMaxOutputTokens > 0
    ? Math.floor(requestedMaxOutputTokens)
    : DEFAULT_MAX_OUTPUT_TOKENS;
  const inputReserve = Math.min(MIN_INPUT_TOKEN_BUDGET, safeContextWindow - 1);
  const maxOutputTokens = Math.min(
    Math.max(1, safeRequestedOutput),
    safeContextWindow - inputReserve,
  );
  return {
    inputBudget: safeContextWindow - maxOutputTokens,
    maxOutputTokens,
  };
}

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
  /** 本轮所在分支的叶消息 publicId,压缩只沿该节点的 parent 链取历史。 */
  branchLeafPublicId: string;
  /** 附件 fileIds。 */
  fileIds?: string[];
  /** route 已完成属主/会话/MIME 校验的本轮消息图片。 */
  messageAttachments?: ResolvedChatImage[];
  /** route 已在消息写入前完成模型视觉能力校验。 */
  visionValidated?: boolean;
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
    userId, conversationId, conv, userContent, model, modelId, messages, branchLeafPublicId,
    fileIds: bodyFileIds, messageAttachments = [], visionValidated = false,
    knowledgeBaseIds, webSearch: webSearchOn,
    templateId, templateVars, instructionCardIds,
    db, schema: s,
  } = input;

  // ===== 阶段 1:知识库 fileIds 合并(后续 vision/RAG 链强依赖,先算)=====
  let fileIds = messageAttachments.length > 0
    ? messageAttachments.map((attachment) => attachment.fileId)
    : bodyFileIds ?? [];
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
      const knownImages = new Map(
        messageAttachments.map((attachment) => [attachment.fileId, attachment]),
      );
      const unresolvedFileIds = fileIds.filter((fileId) => !knownImages.has(fileId));
      if (unresolvedFileIds.length > 0) {
        const fileRows = await db
          .select({
            fileId: s.fileObjects.id,
            filename: s.fileObjects.filename,
            mime: s.fileObjects.mime,
            storagePath: s.fileObjects.storagePath,
          })
          .from(s.fileObjects)
          .where(
            and(
              inArray(s.fileObjects.id, unresolvedFileIds),
              eq(s.fileObjects.userId, userId),
            ),
          );
        for (const row of fileRows as ResolvedChatImage[]) {
          if (row.mime.startsWith("image/")) knownImages.set(row.fileId, row);
        }
      }
      const imageFiles = fileIds.flatMap((fileId) => {
        const file = knownImages.get(fileId);
        return file ? [file] : [];
      });

      if (imageFiles.length > 0) {
        if (!visionValidated) {
          try {
            await assertVisionModel(db, s, { userId, model, modelId });
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : "当前模型不支持图片输入(需 capabilities.vision=true)";
            return {
              ok: false,
              error: NextResponse.json({ error: message }, { status: 400 }),
            };
          }
        }
        const lastUserIdx = effectiveMessages.length - 1;
        if (lastUserIdx >= 0) {
          const lastContent =
            typeof effectiveMessages[lastUserIdx].content === "string"
              ? (effectiveMessages[lastUserIdx].content as string)
              : userContent;
          effectiveMessages[lastUserIdx] = await buildMultimodalUserMessage(
            lastContent,
            imageFiles,
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
          messages: effectiveMessages,
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
      const allCompactionMsgs = (existingMsgs as Record<string, unknown>[]).map((m) => ({
        id: m.id as string,
        publicId: m.publicId as string,
        parentId: (m.parentId as string) ?? null,
        role: m.role as string,
        content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      }));
      const compactionMsgs = selectCurrentBranchMessages(allCompactionMsgs, branchLeafPublicId);
      let compaction: CompactionResult | null = null;
      try {
        compaction = await maybeCompact(conversationId, compactionMsgs);
      } catch (error) {
        console.warn(
          "[chat] 压缩失败,跳过:",
          redactErrorMessage(error, [], "压缩失败"),
        );
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

  // template 的 userMessage 覆盖最后一条 user 的文本,保留图片 part。
  if (templateResult.userMessage && effectiveMessages.length > 0) {
    const lastIdx = effectiveMessages.length - 1;
    effectiveMessages = [...effectiveMessages];
    effectiveMessages[lastIdx] = {
      ...effectiveMessages[lastIdx],
      content: replaceMessageText(
        effectiveMessages[lastIdx].content,
        templateResult.userMessage,
      ) as IRRequest["messages"][number]["content"],
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

  // 输入预算 = 上下文窗口 − 输出预留;不把 maxOutput 当输入预算
  const { inputBudget, maxOutputTokens } = await resolveInputTokenBudget({
    db,
    schema: s,
    userId,
    model,
    modelId,
  });

  // 槽位组装(内部:压缩后丢弃旧历史 + trimToTokenBudget)
  const assembled = assembleContext({
    messages: effectiveMessages as { role: string; content: string | unknown[] }[],
    memories: memoryResult.allMemories,
    recalledMemories: memoryResult.recalledMemories,
    compaction: compactionResult.compaction,
    fileContext: null, // RAG 已在分支 A 直接注入到 messages
    templateSystemPrompt: mergedSystemPrompt,
    maxTokens: inputBudget,
  });

  const trace = buildTrace(assembled, compactionResult.compactionMsgs.length);

  const irRequest: IRRequest = {
    model,
    messages: assembled as IRRequest["messages"],
    stream: true,
    max_tokens: maxOutputTokens,
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

interface BranchMessage {
  id: string;
  publicId: string;
  parentId: string | null;
}

/** 从叶节点沿 parentId 回溯,隔离重试/编辑产生的兄弟分支。 */
export function selectCurrentBranchMessages<T extends BranchMessage>(
  messages: T[],
  leafPublicId: string,
): T[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  let current = messages.find((message) => message.publicId === leafPublicId);
  const branch: T[] = [];
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    branch.push(current);
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return branch.reverse();
}

/** 模板只替换文本 part,避免覆盖同一消息里的图片。 */
export function replaceMessageText(
  content: string | unknown[],
  text: string,
): string | unknown[] {
  if (typeof content === "string") return text;

  const nonTextParts = content.filter(
    (part) => (part as { type?: string } | null)?.type !== "text",
  );
  return [{ type: "text", text }, ...nonTextParts];
}

/**
 * 从 model_catalog 读取 contextWindow / maxOutputTokens,计算输入预算。
 * 查询失败或字段缺失时回退兼容默认值;始终为输出预留空间。
 */
async function resolveInputTokenBudget(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  userId: string;
  model: string;
  modelId?: string;
}): Promise<{ inputBudget: number; maxOutputTokens: number }> {
  const { db, schema: s, userId, model, modelId } = args;
  let contextWindow = DEFAULT_CONTEXT_WINDOW;
  let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;

  try {
    const visibility = or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, userId));
    const [row] = modelId
      ? await db
          .select({
            contextWindow: s.modelCatalog.contextWindow,
            maxOutputTokens: s.modelCatalog.maxOutputTokens,
          })
          .from(s.models)
          .innerJoin(s.modelCatalog, eq(s.models.catalogId, s.modelCatalog.id))
          .where(and(eq(s.models.id, modelId), eq(s.models.enabled, true), visibility))
          .limit(1)
      : await db
          .select({
            contextWindow: s.modelCatalog.contextWindow,
            maxOutputTokens: s.modelCatalog.maxOutputTokens,
          })
          .from(s.models)
          .innerJoin(s.modelCatalog, eq(s.models.catalogId, s.modelCatalog.id))
          .where(and(eq(s.models.name, model), eq(s.models.enabled, true), visibility))
          .limit(1);

    if (typeof row?.contextWindow === "number" && row.contextWindow > 0) {
      contextWindow = row.contextWindow;
    }
    if (typeof row?.maxOutputTokens === "number" && row.maxOutputTokens > 0) {
      maxOutputTokens = row.maxOutputTokens;
    }
  } catch {
    /* catalog 查询失败:使用兼容默认值 */
  }

  return calculateTokenBudgets(contextWindow, maxOutputTokens);
}
