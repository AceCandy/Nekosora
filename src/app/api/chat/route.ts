/**
 * WebChat 流式端点 —— POST /api/chat
 *
 * 流程:
 *   1. session 鉴权(Better Auth)
 *   2. 校验会话属主,保存 user 消息
 *   3. 上下文准备(prepareChatContext:RAG/记忆/压缩/system 合并/trace)→ IRRequest
 *   4. 流式执行 + SSE 编码 + 收尾副作用(落库/artifact/标题/记忆)
 *
 * 上下文准备由 orchestrator 负责；流式状态机与核心收尾事务由 completion coordinator 负责。
 * route 只保留鉴权、请求准备和取消安全的 SSE 编码。
 */
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";
import { writeFallbackTitle } from "@/lib/conversation-title/service";
import { dispatchConversationTitleJob } from "@/lib/conversation-title/dispatch";
import { prepareChatContext } from "@/lib/chat/orchestrator";
import {
  findConversationMessage,
  withConversationMessageWrite,
} from "@/lib/chat/message-reference";
import {
  createRunId,
} from "@/lib/chat/run-lifecycle";
import {
  executeChatCompletion,
  type ChatCompletionEvent,
  type ChatCompletionOutcomeKind,
} from "@/lib/chat/completion-coordinator";
import type { ChatTerminalStatus } from "@/lib/chat/sse-contract";
import { redactErrorMessage } from "@/lib/redaction";
import type { IRRequest } from "@/lib/providers/types";
import type { ReasoningLevel } from "@/db/types";
import { toMessageCreatedAtIso } from "@/features/chat/model/messageTime";
import {
  assertVisionModel,
  ChatAttachmentError,
  insertMessageAttachments,
  loadMessageAttachmentsByMessageIds,
  normalizeAttachmentFileIds,
  resolveChatImageAttachments,
  type ResolvedChatImage,
} from "@/lib/chat/message-attachments";

const chatComposerSnapshotSchema = z.object({
  outputModeId: z.string().min(1).nullable().optional(),
  reasoning: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
});

const TERMINAL_STATUS_BY_OUTCOME = {
  cancelled_before_start: "interrupted",
  start_failed: "failed",
  committed_success: "success",
  committed_failed: "failed",
  committed_interrupted: "interrupted",
  persistence_failed: "failed",
} satisfies Record<ChatCompletionOutcomeKind, ChatTerminalStatus>;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestStartedAt = performance.now();
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    conversationId: string;
    model: string;
    /** 模型 id(WebChat byId 路由解析;缺省则回退 by name)。 */
    modelId?: string;
    messages: IRRequest["messages"];
    fileIds?: unknown;
    // 分支支持:可选指定父消息/源消息的 publicId(retry/edit 时)
    parentPublicId?: string;
    sourcePublicId?: string;
    branchReason?: string;
    /**
     * 本轮 user 消息的 publicId。
     * - send 流程不传:由后端生成并插入新 user 消息。
     * - edit/retry 流程传入:跳过 user 消息插入(编辑已原地改写 / 重生成复用原 user),
     *   仅用于 finally 关联 assistant 消息的 parentId。
     */
    userPublicId?: string;
    // 续写:在指定 assistant 消息内容末尾继续生成(复用其 publicId,update 同一行)。
    continueFromPublicId?: string;
    // P2-B:模板 ID + 变量(用户选定模板时传入)。
    templateId?: string;
    templateVars?: Record<string, string>;
    // I-12b:指令卡 ID 列表(用户在 chat 勾选的指令卡,渲染为 system 上下文注入)。
    instructionCardIds?: string[];
    // P1-6:联网搜索开关(前端 toggle)。on/off。
    webSearch?: boolean;
    // P2-10a:挂载的知识库 ID(检索其下文件 chunks)。
    knowledgeBaseIds?: string[];
    /** WebChat 点击发送时的 Composer 快照；缺省兼容旧客户端并回退会话行。 */
    outputModeId?: unknown;
    reasoning?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体非法" }, { status: 400 });
  }
  if (
    !body.conversationId ||
    !body.model ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return NextResponse.json({ error: "缺少 conversationId/model/messages" }, { status: 400 });
  }
  const composerSnapshot = chatComposerSnapshotSchema.safeParse(body);
  if (!composerSnapshot.success) {
    return NextResponse.json({ error: "输入区状态非法" }, { status: 400 });
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 校验会话属主
  const [conv] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, body.conversationId))
    .limit(1);
  if (!conv || conv.userId !== user.id) {
    return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 403 });
  }

  // 取最后一条 user 消息保存
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  const userContent =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : JSON.stringify(lastUserMsg?.content ?? "");

  let messageAttachments: ResolvedChatImage[] = [];
  let visionValidated = false;
  const attachmentError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "图片附件无效";
    return NextResponse.json({ error: message }, { status: 400 });
  };

  // 普通发送由客户端声明本轮附件；编辑/重试必须从既有用户消息关联读取。
  if (!body.userPublicId && !body.continueFromPublicId) {
    try {
      messageAttachments = await resolveChatImageAttachments(db, s, {
        userId: user.id,
        conversationId: body.conversationId,
        fileIds: body.fileIds,
      });
      if (messageAttachments.length > 0) {
        await assertVisionModel(db, s, {
          userId: user.id,
          model: body.model,
          modelId: body.modelId,
        });
        visionValidated = true;
      }
    } catch (error) {
      if (error instanceof ChatAttachmentError) return attachmentError(error);
      throw error;
    }
  } else {
    try {
      if (normalizeAttachmentFileIds(body.fileIds).length > 0) {
        return NextResponse.json(
          { error: "编辑、重试或续写不能重新声明历史附件" },
          { status: 400 },
        );
      }
    } catch (error) {
      return attachmentError(error);
    }
  }

  // 分支:将 parentPublicId/sourcePublicId 解析为内部 id
  let parentIdInternal: string | null = null;
  let sourceIdInternal: string | null = null;
  if (body.parentPublicId) {
    const parent = await findConversationMessage(db, s, body.conversationId, {
      publicId: body.parentPublicId,
    });
    if (!parent) {
      return NextResponse.json({ error: "父消息不存在或不属于当前会话" }, { status: 400 });
    }
    parentIdInternal = parent.id as string;
  }
  if (body.sourcePublicId) {
    const source = await findConversationMessage(db, s, body.conversationId, {
      publicId: body.sourcePublicId,
    });
    if (!source) {
      return NextResponse.json({ error: "源消息不存在或不属于当前会话" }, { status: 400 });
    }
    sourceIdInternal = source.id as string;
  }

  // 续写模式:在指定 assistant 消息末尾继续生成。复用其 publicId 与所在行,
  // finally 改走 update;stream 只发新增 delta(前端追加到既有内容)。
  let isContinue = false;
  let continuePrefixText = "";
  let continueAssistantInternalId: string | null = null;
  let continueParentUserInternalId: string | null = null;
  let continueParentUserPublicId: string | null = null;
  let continueAssistantCreatedAt: string | undefined;
  let continueParentUserCreatedAt: string | undefined;
  if (body.continueFromPublicId) {
    const contMsg = await findConversationMessage(db, s, body.conversationId, {
      publicId: body.continueFromPublicId,
    });
    if (!contMsg) {
      return NextResponse.json({ error: "续写消息不存在或不属于该会话" }, { status: 400 });
    }
    if (contMsg.role !== "assistant") {
      return NextResponse.json({ error: "仅支持在 assistant 消息上续写" }, { status: 400 });
    }
    isContinue = true;
    continueAssistantInternalId = contMsg.id as string;
    continueAssistantCreatedAt = toMessageCreatedAtIso(contMsg.createdAt);
    continuePrefixText =
      typeof contMsg.content === "string" ? contMsg.content : String(contMsg.content ?? "");
    if (contMsg.parentId) {
      const parentUser = await findConversationMessage(db, s, body.conversationId, {
        id: contMsg.parentId as string,
      });
      if (parentUser?.role === "user") {
        continueParentUserInternalId = parentUser.id as string;
        continueParentUserPublicId = parentUser.publicId as string;
        continueParentUserCreatedAt = toMessageCreatedAtIso(parentUser.createdAt);
      }
    }
    if (!continueParentUserPublicId) {
      return NextResponse.json({ error: "续写消息缺少当前会话内的用户父消息" }, { status: 400 });
    }
  }

  // 本轮生成唯一 runId:Agent 多轮共享;与 streamChat / usage 日志 requestId 对齐。
  const runId = createRunId();

  // user 消息:
  // - send 流程(无 userPublicId):生成并插入新 user 消息(带本轮 runId)。
  // - edit/retry 流程(传入 userPublicId):跳过插入,复用既有 user,不篡改历史 runId 归属。
  // - continue:沿用原 user 父消息,不改其 runId。
  let userPublicId: string;
  let userMessageInternalId: string | null = null;
  let userCreatedAt: string | undefined;
  if (isContinue) {
    if (!continueParentUserPublicId) {
      return NextResponse.json({ error: "续写消息缺少用户父消息" }, { status: 400 });
    }
    // 续写沿用原 user 父消息,不插入新 user
    userPublicId = continueParentUserPublicId;
    userMessageInternalId = continueParentUserInternalId;
    userCreatedAt = continueParentUserCreatedAt;
  } else if (body.userPublicId) {
    const userMessage = await findConversationMessage(db, s, body.conversationId, {
      publicId: body.userPublicId,
    });
    if (!userMessage || userMessage.role !== "user") {
      return NextResponse.json({ error: "用户消息不存在或不属于当前会话" }, { status: 400 });
    }
    userPublicId = body.userPublicId;
    userMessageInternalId = userMessage.id as string;
    userCreatedAt = toMessageCreatedAtIso(userMessage.createdAt);
    const attachmentsByMessageId = await loadMessageAttachmentsByMessageIds(db, s, {
      userId: user.id,
      conversationId: body.conversationId,
      messageIds: [userMessageInternalId],
    });
    messageAttachments = attachmentsByMessageId.get(userMessageInternalId) ?? [];
    if (messageAttachments.length > 0) {
      try {
        await assertVisionModel(db, s, {
          userId: user.id,
          model: body.model,
          modelId: body.modelId,
        });
        visionValidated = true;
      } catch (error) {
        if (error instanceof ChatAttachmentError) return attachmentError(error);
        throw error;
      }
    }
  } else {
    if (!userContent.trim() && messageAttachments.length === 0) {
      return NextResponse.json({ error: "消息内容和图片不能同时为空" }, { status: 400 });
    }
    userPublicId = crypto.randomUUID();
    const createdAt = new Date();
    userCreatedAt = createdAt.toISOString();
    const insertedUser = await withConversationMessageWrite(
      db,
      s,
      body.conversationId,
      user.id,
      async (tx) => {
        if (parentIdInternal) {
          const activeParent = await findConversationMessage(
            tx,
            s,
            body.conversationId,
            { id: parentIdInternal },
          );
          if (!activeParent) return { error: "parent" as const };
        }
        if (sourceIdInternal) {
          const activeSource = await findConversationMessage(
            tx,
            s,
            body.conversationId,
            { id: sourceIdInternal },
          );
          if (!activeSource) return { error: "source" as const };
        }

        const [inserted] = await tx
          .insert(s.messages)
          .values({
            conversationId: body.conversationId,
            publicId: userPublicId,
            parentId: parentIdInternal,
            sourceId: sourceIdInternal,
            branchReason: body.branchReason ?? null,
            runId,
            role: "user",
            content: userContent,
            status: "success",
            createdAt,
          })
          .returning({ id: s.messages.id });
        await insertMessageAttachments(tx, s, inserted.id as string, messageAttachments);
        return { id: inserted.id as string };
      },
    );
    if (insertedUser === null) {
      return NextResponse.json({ error: "会话不存在或无权访问" }, { status: 403 });
    }
    if ("error" in insertedUser) {
      const error =
        insertedUser.error === "parent"
          ? "父消息不存在或不属于当前会话"
          : "源消息不存在或不属于当前会话";
      return NextResponse.json({ error }, { status: 400 });
    }
    userMessageInternalId = insertedUser.id;

    // fallback 与 outbox 原子提交；即时投递失败由 worker 周期扫描恢复。
    try {
      const titleJob = await writeFallbackTitle(
        user.id,
        body.conversationId,
        userContent,
        body.model,
        body.modelId,
      );
      if (titleJob) {
        void dispatchConversationTitleJob(titleJob.id)
          .catch((error) =>
            console.error(
              "[chat] conversation-title dispatch failed:",
              redactErrorMessage(error),
            ),
          );
      }
    } catch {
      /* fallback 写入失败不阻断主回答 */
    }
  }

  // ===== 段 A:上下文准备(抽到 orchestrator,纯输入→输出)=====
  const prepared = await prepareChatContext({
    userId: user.id,
    conversationId: body.conversationId,
    conv: {
      outputModeId: composerSnapshot.data.outputModeId === undefined
        ? conv.outputModeId
        : composerSnapshot.data.outputModeId,
    },
    userContent,
    model: body.model,
    modelId: body.modelId,
    messages: body.messages,
    branchLeafPublicId: isContinue ? body.continueFromPublicId! : userPublicId,
    messageAttachments,
    visionValidated,
    knowledgeBaseIds: body.knowledgeBaseIds,
    webSearch: body.webSearch,
    templateId: body.templateId,
    templateVars: body.templateVars,
    instructionCardIds: body.instructionCardIds,
    db,
    schema: s,
  });
  // vision 校验失败时提前返回 400(保留原行为)
  if ("error" in prepared) return prepared.error;
  const { irRequest, trace, searchBundle, ragStatus, compaction } = prepared;

  const composerState = (conv.composerState as { reasoningByModelId?: Record<string, ReasoningLevel> } | null) ?? {};
  const reasoning = composerSnapshot.data.reasoning
    ?? (body.modelId ? composerState.reasoningByModelId?.[body.modelId] : undefined);
  if (reasoning !== undefined) {
    irRequest.reasoning = reasoning;
  }

  const ctx = { userId: user.id, keyKind: null as null, source: "chat" as const };

  if (!userMessageInternalId) {
    return NextResponse.json({ error: "用户父消息已失效" }, { status: 409 });
  }

  // 流式返回:text/event-stream,每条 text-delta 作为一行
  const encoder = new TextEncoder();
  // 提前生成 assistant 消息 publicId:在流首帧回传给前端,使生成期间即可显示操作按钮;
  // completion transaction 落库时复用同一标识。
  const assistantPublicId = isContinue ? body.continueFromPublicId! : crypto.randomUUID();
  const assistantCreatedAt = new Date();
  const assistantCreatedAtIso = isContinue
    ? continueAssistantCreatedAt
    : assistantCreatedAt.toISOString();
  // 客户端断开(刷新 / 关页 / HMR / req.signal abort)→ 中止上游生成,避免继续写已关闭 socket
  // 触发 Socket closed unexpectedly → uncaughtException 反复冲击 dev server。req.signal 在部分场景
  // 不可靠,由 ReadableStream.cancel() 兜底,二者都触发同一个 AbortController。
  const abortCtl = new AbortController();
  const onRequestAbort = () => {
    abortCtl.abort();
  };
  if (req.signal.aborted) {
    onRequestAbort();
  } else {
    req.signal.addEventListener("abort", onRequestAbort, { once: true });
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端断开后 controller 处于已关闭态:统一经 safeEnqueue 写入,避免向已关闭流 enqueue 抛错。
      const safeEnqueue = (chunk: Uint8Array) => {
        if (abortCtl.signal.aborted) return;
        try {
          controller.enqueue(chunk);
        } catch {
          /* controller 已随客户端断开关闭,丢弃 */
        }
      };
      const emitContextEvents = () => {
        if (!isContinue) {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "user_message", publicId: userPublicId, createdAt: userCreatedAt })}\n\n`,
          ));
        }
        safeEnqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "assistant_message", publicId: assistantPublicId, createdAt: assistantCreatedAtIso })}\n\n`,
        ));
        if (searchBundle?.hit) {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "search_result", results: searchBundle.results })}\n\n`,
          ));
        }
        if (ragStatus) {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "rag_search", status: ragStatus })}\n\n`,
          ));
        }
        if (compaction?.compacted) {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "compact", strategy: compaction.strategy, level: compaction.fallbackLevel })}\n\n`,
          ));
        }
      };
      const emit = (event: ChatCompletionEvent) => {
        if (event.type === "started") {
          emitContextEvents();
        } else if (event.type === "text-delta") {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "delta", text: event.text })}\n\n`,
          ));
        } else if (event.type === "reasoning-delta") {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "reasoning", text: event.text })}\n\n`,
          ));
        } else if (event.type === "tool-call") {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "tool_call", toolName: event.toolName, args: event.args })}\n\n`,
          ));
        } else if (event.type === "tool-result") {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "tool_result", toolName: event.toolName, isError: event.isError })}\n\n`,
          ));
        } else if (event.type === "error") {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: event.error, code: event.code })}\n\n`,
          ));
        } else if (event.type === "finish") {
          safeEnqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "finish", metadata: event.metadata })}\n\n`,
          ));
        }
      };

      try {
        const outcome = await executeChatCompletion({
          ctx,
          request: irRequest,
          modelId: body.modelId,
          runId,
          conversationId: body.conversationId,
          userId: user.id,
          userMessageInternalId,
          userContent,
          sourceIdInternal,
          assistant: isContinue
            ? {
                kind: "continue",
                internalId: continueAssistantInternalId!,
                publicId: assistantPublicId,
                prefixText: continuePrefixText,
              }
            : {
                kind: "insert",
                publicId: assistantPublicId,
                createdAt: assistantCreatedAt,
              },
          processTrace: trace,
          memoryMessages: body.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          requestStartedAt,
          signal: abortCtl.signal,
          emit,
        });
        safeEnqueue(encoder.encode(
          `data: ${JSON.stringify({
            type: "terminal",
            status: TERMINAL_STATUS_BY_OUTCOME[outcome.kind],
          })}\n\n`,
        ));
        safeEnqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        req.signal.removeEventListener("abort", onRequestAbort);
        try {
          controller.close();
        } catch {
          /* 客户端断开已取消流,忽略重复关闭 */
        }
      }
    },
    // 客户端断开时触发:中止上游生成(req.signal 在部分场景不可靠,cancel 兜底)。
    cancel() {
      abortCtl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
