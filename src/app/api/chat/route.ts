/**
 * WebChat 流式端点 —— POST /api/chat
 *
 * 流程:
 *   1. session 鉴权(Better Auth)
 *   2. 校验会话属主,保存 user 消息
 *   3. 构造 CallContext(用户态,keyKind=null),调用 streamChat()
 *   4. 创建 assistant 占位消息,流式更新(简化:流结束后整体写入)
 *   5. 返回纯文本流(SSE 形式,供前端读取)
 *
 * 复用 streamChat()(阶段 3),与对外网关同一核心。
 */
import { eq, and, inArray } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";
import { streamChat } from "@/lib/stream";
import type { IRRequest } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    conversationId: string;
    model: string;
    messages: IRRequest["messages"];
    fileIds?: string[];
    // 分支支持:可选指定父消息/源消息的 publicId(retry/edit 时)
    parentPublicId?: string;
    sourcePublicId?: string;
    branchReason?: string;
    // P2-B:模板 ID + 变量(用户选定模板时传入)。
    templateId?: string;
    templateVars?: Record<string, string>;
    // I-12b:指令卡 ID 列表(用户在 chat 勾选的指令卡,渲染为 system 上下文注入)。
    instructionCardIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体非法" }, { status: 400 });
  }
  if (!body.conversationId || !body.model || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "缺少 conversationId/model/messages" }, { status: 400 });
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

  // 分支:将 parentPublicId/sourcePublicId 解析为内部 id
  let parentIdInternal: string | null = null;
  let sourceIdInternal: string | null = null;
  if (body.parentPublicId) {
    const [p] = await db.select().from(s.messages).where(eq(s.messages.publicId, body.parentPublicId)).limit(1);
    parentIdInternal = p?.id ?? null;
  }
  if (body.sourcePublicId) {
    const [p] = await db.select().from(s.messages).where(eq(s.messages.publicId, body.sourcePublicId)).limit(1);
    sourceIdInternal = p?.id ?? null;
  }

  // user 消息:parentId 指向其父(分支时);sourceId 指向被编辑的原消息
  const userPublicId = crypto.randomUUID();
  await db.insert(s.messages).values({
    conversationId: body.conversationId,
    publicId: userPublicId,
    parentId: parentIdInternal,
    sourceId: sourceIdInternal,
    branchReason: body.branchReason ?? null,
    role: "user",
    content: userContent,
    status: "success",
  });

  // ===== RAG 检索(三模式:auto / full_context / rag) =====
  let effectiveMessages = body.messages;
  let ragStatus: string | null = null;
  const fileIds = body.fileIds ?? [];

  // ===== P1-C:vision 图片附件分离 =====
  // 图片不走 RAG 文本提取(已在 extract.ts 标 image_skipped),
  // 而是组装成 multimodal user 消息发给 vision 模型。
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
    // 校验模型是否支持 vision。
    const [modelRow] = await db
      .select()
      .from(s.globalModels)
      .where(and(eq(s.globalModels.name, body.model), eq(s.globalModels.enabled, true)))
      .limit(1);
    const caps = modelRow?.capabilities as { vision?: boolean } | undefined;
    if (!caps?.vision) {
      return NextResponse.json(
        { error: "当前模型不支持图片输入(需 capabilities.vision=true)" },
        { status: 400 },
      );
    }
    // 把最后一条 user 消息升级为 multimodal。
    const lastUserIdx = effectiveMessages.length - 1;
    if (lastUserIdx >= 0) {
      const { buildMultimodalUserMessage } = await import("@/lib/multimodal/assemble");
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
      .where(and(eq(s.userSettings.userId, user.id), eq(s.userSettings.key, "chat.file_mode")))
      .limit(1);
    const fileMode = (modeRow?.value as string) ?? "auto";

    const { buildMessagesWithFileContext } = await import("@/lib/rag/context");
    const built = await buildMessagesWithFileContext({
      messages: body.messages,
      fileIds,
      fileMode: fileMode as "auto" | "full_context" | "rag",
      query: userContent,
    });
    effectiveMessages = built.messages as IRRequest["messages"];
    ragStatus = built.ragStatus;
  }

  // ===== 长期记忆 + 上下文压缩 + 槽位组装 =====
  const { getMemories } = await import("@/lib/memory/service");
  const { maybeCompact } = await import("@/lib/compact/service");
  const { assembleContext } = await import("@/lib/context-assembler");

  // 加载用户记忆(带缓存)
  const memories = await getMemories(user.id).catch(() => []);

  // 上下文压缩(读取历史消息判断是否需要摘要)
  // 取已有消息(从 DB 读当前会话消息路径,用于 CoveragePathHash)
  const existingMsgs = await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.conversationId, body.conversationId))
    .orderBy(s.messages.createdAt);
  const compactionMsgs = (existingMsgs as Record<string, unknown>[]).map((m) => ({
    id: m.id as string,
    publicId: m.publicId as string,
    parentId: (m.parentId as string) ?? null,
    role: m.role as string,
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
  }));
  let compaction = null;
  try {
    compaction = await maybeCompact(body.conversationId, compactionMsgs);
  } catch (err) {
    console.warn("[chat] 压缩失败,跳过:", err);
  }

  // ===== P2-B:加载 Prompt 模板(若指定)=====
  let templateSystemPrompt: string | null = null;
  if (body.templateId) {
    const { getTemplate, renderTemplate, incUseCount } = await import("@/lib/templates/service");
    const tpl = await getTemplate({ userId: user.id }, body.templateId);
    if (tpl) {
      const rendered = renderTemplate(tpl, body.templateVars ?? {});
      templateSystemPrompt = rendered.systemPrompt;
      // 若模板有 userTemplate,替换最后一条 user 消息内容。
      if (rendered.userMessage && effectiveMessages.length > 0) {
        const lastIdx = effectiveMessages.length - 1;
        effectiveMessages[lastIdx] = {
          ...effectiveMessages[lastIdx],
          content: rendered.userMessage,
        };
      }
      incUseCount(tpl.id).catch(() => {}); // 异步计数,不阻塞
    }
  }

  // ===== I-12b:加载指令卡(若指定)=====
  // 把选中的指令卡渲染为 <instruction_card_context> XML,追加到 system prompt。
  // 纯文本上下文,无执行能力(契约见 renderCardContext)。
  let cardSystemPrompt: string | null = null;
  if (body.instructionCardIds && body.instructionCardIds.length > 0) {
    const { getCardsByIds, renderCardContext, incUseCount: incCardUse } = await import(
      "@/lib/instruction-cards/service"
    );
    const cards = await getCardsByIds(user.id, body.instructionCardIds);
    cardSystemPrompt = renderCardContext(cards);
    if (cards.length > 0) {
      incCardUse(cards.map((c) => c.id)).catch(() => {}); // 异步计数
    }
  }
  // 合并 template + card 两个 system 来源(均作为额外 system 指令)。
  const extraSystemParts = [templateSystemPrompt, cardSystemPrompt].filter(
    (p): p is string => p !== null,
  );
  const mergedSystemPrompt =
    extraSystemParts.length > 0 ? extraSystemParts.join("\n\n") : null;

  // 提取 RAG 注入的文件上下文(若 RAG 已把 system 注入 effectiveMessages,这里分离出来给 assembler)
  // 简化:RAG 已直接修改了 effectiveMessages 的 system 块,assembler 会保留它。
  const assembled = assembleContext({
    messages: effectiveMessages as { role: string; content: string | unknown[] }[],
    memories,
    compaction,
    fileContext: null, // RAG 已在上一步直接注入到 messages
    templateSystemPrompt: mergedSystemPrompt, // 合并 template + 指令卡
    maxTokens: 32000,
  });

  // ===== process_trace:记录实际发送给模型的 prompt 结构 =====
  const { buildTrace } = await import("@/lib/trace");
  const trace = buildTrace(assembled);

  // 构造调用上下文(用户态,非 key)
  const irRequest: IRRequest = {
    model: body.model,
    messages: assembled as IRRequest["messages"],
    stream: true,
  };
  const ctx = { userId: user.id, keyKind: null as null, source: "chat" as const };

  // 流式返回:text/event-stream,每条 text-delta 作为一行
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      // 如有 RAG 检索结果,先发一个 rag_search 事件供 UI 显示
      if (ragStatus) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "rag_search", status: ragStatus })}\n\n`));
      }
      // 如触发了压缩,发 compact 事件
      if (compaction?.compacted) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "compact", strategy: compaction.strategy, level: compaction.fallbackLevel })}\n\n`,
          ),
        );
      }
      // 发 process_trace 事件(供 UI 调试折叠面板)
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "trace", trace })}\n\n`),
      );
      try {
        // P1-A:解析 MCP server。有可用工具则走 agent loop,否则普通 streamChat。
        const { resolveMcpServers } = await import("@/lib/mcp/registry");
        const { streamChatWithTools } = await import("@/lib/stream");
        const mcpServers = await resolveMcpServers(ctx).catch(() => []);
        const hasTools = mcpServers.some((sv) => sv.tools.length > 0);
        const gen = hasTools
          ? streamChatWithTools({ ctx, request: irRequest, mcpServers })
          : streamChat({ ctx, request: irRequest });
        for await (const ev of gen) {
          if (ev.type === "text-delta") {
            assistantText += ev.text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: ev.text })}\n\n`));
          } else if (ev.type === "finish") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish", usage: ev.usage })}\n\n`));
          } else if (ev.type === "tool-call") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", toolName: ev.toolName, args: ev.args })}\n\n`));
          } else if (ev.type === "tool-result") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", toolName: ev.toolName, isError: ev.isError })}\n\n`));
          } else if (ev.type === "error") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: ev.error, code: ev.code })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: err instanceof Error ? err.message : "内部错误" })}\n\n`),
        );
      } finally {
        // 持久化 assistant 消息;parentId 指向本轮 user 消息;附 process_trace
        const [userMsgRow] = await db
          .select({ id: s.messages.id })
          .from(s.messages)
          .where(eq(s.messages.publicId, userPublicId))
          .limit(1);
        const assistantPublicId = crypto.randomUUID();
        await db.insert(s.messages).values({
          conversationId: body.conversationId,
          publicId: assistantPublicId,
          parentId: userMsgRow?.id ?? null,
          role: "assistant",
          content: assistantText,
          status: assistantText ? "success" : "interrupted",
          processTrace: trace,
        });

        // P1-B:抽取 artifact(代码块/Mermaid/SVG 等)并持久化。
        if (assistantText) {
          try {
            const { extractArtifacts } = await import("@/lib/artifacts/extract");
            const { artifacts: parsed } = extractArtifacts(assistantText);
            if (parsed.length > 0) {
              const [assistantMsgRow] = await db
                .select({ id: s.messages.id })
                .from(s.messages)
                .where(eq(s.messages.publicId, assistantPublicId))
                .limit(1);
              if (assistantMsgRow) {
                await db.insert(s.artifacts).values(
                  parsed.map((a) => ({
                    messageId: assistantMsgRow.id,
                    conversationId: body.conversationId,
                    userId: user.id,
                    kind: a.kind,
                    title: a.title,
                    language: a.language,
                    content: a.content,
                  })),
                );
              }
            }
          } catch {
            /* artifact 抽取失败不阻断主流程 */
          }
        }
        // 更新会话时间
        await db.update(s.conversations).set({ updatedAt: new Date() }).where(eq(s.conversations.id, body.conversationId));
        controller.close();
      }
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
