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
    /**
     * 本轮 user 消息的 publicId。
     * - send 流程不传:由后端生成并插入新 user 消息。
     * - edit/retry 流程传入:跳过 user 消息插入(编辑已原地改写 / 重生成复用原 user),
     *   仅用于 finally 关联 assistant 消息的 parentId。
     */
    userPublicId?: string;
    // P2-B:模板 ID + 变量(用户选定模板时传入)。
    templateId?: string;
    templateVars?: Record<string, string>;
    // I-12b:指令卡 ID 列表(用户在 chat 勾选的指令卡,渲染为 system 上下文注入)。
    instructionCardIds?: string[];
    // P1-6:联网搜索开关(前端 toggle)。on/off。
    webSearch?: boolean;
    // P2-10a:挂载的知识库 ID(检索其下文件 chunks)。
    knowledgeBaseIds?: string[];
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

  // user 消息:
  // - send 流程(无 userPublicId):生成并插入新 user 消息。
  // - edit/retry 流程(传入 userPublicId):跳过插入,复用既有的 user 消息。
  let userPublicId: string;
  if (body.userPublicId) {
    userPublicId = body.userPublicId;
  } else {
    userPublicId = crypto.randomUUID();
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
  }

  // ===== RAG 检索(三模式:auto / full_context / rag) =====
  let effectiveMessages = body.messages;
  let ragStatus: string | null = null;
  // 合并附件 fileIds + 知识库 fileIds(知识库文件纳入 RAG 检索范围)
  let fileIds = body.fileIds ?? [];
  if (body.knowledgeBaseIds && body.knowledgeBaseIds.length > 0) {
    const { getFileIdsByKnowledgeBases } = await import("@/lib/knowledge-base/service");
    const kbFileIds = await getFileIdsByKnowledgeBases(body.knowledgeBaseIds);
    fileIds = [...new Set([...fileIds, ...kbFileIds])];
  }

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

  // ===== 联网搜索(可选)=====
  // 优先用请求体 webSearch(前端 toggle),其次读用户 chat.web_search 设置
  let searchBundle: { results: { title: string; url: string; snippet: string }[]; hit: boolean } | null = null;
  const webSearchOn = body.webSearch === true;
  if (webSearchOn) {
    const { searchWeb } = await import("@/lib/web-search/service");
    searchBundle = await searchWeb(userContent);
  }

  // ===== 长期记忆 + 上下文压缩 + 槽位组装 =====
  const { getMemories } = await import("@/lib/memory/service");
  const { maybeCompact } = await import("@/lib/compact/service");
  const { assembleContext } = await import("@/lib/context-assembler");

  // 加载用户记忆(带缓存):preference 全量 + profile/custom 语义召回
  const allMemories = await getMemories(user.id).catch(() => []);
  let memories = allMemories;
  try {
    const { recallMemories } = await import("@/lib/memory/recall");
    const recalled = await recallMemories(user.id, userContent);
    if (recalled.length > 0) {
      // preference 仍走全量;profile/custom 用召回结果替换
      const prefs = allMemories.filter((m: { scope: string }) => m.scope === "preference");
      memories = [...prefs, ...recalled];
    }
  } catch {
    /* 召回失败回退全量 */
  }

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

  // ===== 输出方式(会话级:读 conversations.outputModeId,注入对应 systemPrompt)=====
  let outputModePrompt: string | null = null;
  if (conv.outputModeId) {
    const { getOutputMode } = await import("@/lib/output-modes/service");
    const mode = await getOutputMode(conv.outputModeId).catch(() => null);
    if (mode?.enabled && mode.systemPrompt) {
      outputModePrompt = mode.systemPrompt;
    }
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
  // 合并 output_mode + template + card + web_search 四个 system 来源(均作为额外 system 指令)。
  let searchContext: string | null = null;
  if (searchBundle?.hit) {
    const { renderSearchContext } = await import("@/lib/web-search/service");
    searchContext = renderSearchContext(searchBundle.results);
  }
  const extraSystemParts = [outputModePrompt, templateSystemPrompt, cardSystemPrompt, searchContext].filter(
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
  // originalMessageCount = 压缩前 DB 中的消息总数(沿当前分支),供 UI 展示压缩前后对比
  const trace = buildTrace(assembled, compactionMsgs.length);

  // 构造调用上下文(用户态,非 key)
  // max_tokens 全局兜底:模型表暂无该字段,统一给一个较大值避免被上游默认值
  // (如 ARK 的 4096)在长输出处截断。将来可改为从模型配置读取。
  const irRequest: IRRequest = {
    model: body.model,
    messages: assembled as IRRequest["messages"],
    stream: true,
    max_tokens: 16384,
  };
  const ctx = { userId: user.id, keyKind: null as null, source: "chat" as const };

  // 流式返回:text/event-stream,每条 text-delta 作为一行
  const encoder = new TextEncoder();
  // 标记会话为「生成中」(供侧栏转圈标识;在 finally 中清除)
  await db.update(s.conversations).set({ generating: true }).where(eq(s.conversations.id, body.conversationId));
  // 提前生成 assistant 消息 publicId:在流首帧回传给前端,使生成期间即可显示操作按钮;
  // finally 落库时复用同一标识。
  const assistantPublicId = crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      let assistantReasoning = "";
      // 回传本轮 user 消息的 publicId,供前端回填后支持编辑重发。
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "user_message", publicId: userPublicId })}\n\n`),
      );
      // 回传本轮 assistant 占位消息的 publicId,供前端回填后无需刷新即可显示操作按钮。
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "assistant_message", publicId: assistantPublicId })}\n\n`),
      );
      // 如有联网搜索结果,发 search_result 事件供 UI 展示引用
      if (searchBundle?.hit) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "search_result", results: searchBundle.results })}\n\n`,
          ),
        );
      }
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
          } else if (ev.type === "reasoning-delta") {
            assistantReasoning += ev.text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "reasoning", text: ev.text })}\n\n`));
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
        await db.insert(s.messages).values({
          conversationId: body.conversationId,
          publicId: assistantPublicId,
          parentId: userMsgRow?.id ?? null,
          role: "assistant",
          content: assistantText,
          reasoning: assistantReasoning || null,
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
        // 更新会话时间 + 清除「生成中」标记
        await db
          .update(s.conversations)
          .set({ updatedAt: new Date(), generating: false })
          .where(eq(s.conversations.id, body.conversationId));

        // 异步提取记忆 + 自动生成会话标题(不阻塞响应;失败静默)
        if (assistantText) {
          const recentMessages = [...body.messages, { role: "assistant", content: assistantText }]
            .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content ?? "") }));
          const { extractMemories } = await import("@/lib/memory/extract");
          extractMemories(user.id, body.conversationId, recentMessages, body.model).catch(() => {});

          // 首条 user 消息触发标题自动生成(service 内判断仅默认标题才生成)。
          // 通过 onTitle 回调推送 title_updated 帧(fallback 和最终标题各一次),
          // 由前端 router.refresh 刷新会话列表。
          try {
            const { maybeGenerateTitle } = await import("@/lib/conversation-title/service");
            await maybeGenerateTitle(user.id, body.conversationId, userContent, body.model, (title) => {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "title_updated", title, conversationId: body.conversationId })}\n\n`,
                ),
              );
            });
          } catch {
            /* 标题生成失败不阻断主流程 */
          }
        }
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
