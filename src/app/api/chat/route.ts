/**
 * WebChat 流式端点 —— POST /api/chat
 *
 * 流程:
 *   1. session 鉴权(Better Auth)
 *   2. 校验会话属主,保存 user 消息
 *   3. 上下文准备(prepareChatContext:RAG/记忆/压缩/system 合并/trace)→ IRRequest
 *   4. 流式执行 + SSE 编码 + 收尾副作用(落库/artifact/标题/记忆)
 *
 * 段 A(上下文准备)已抽到 @/lib/chat/orchestrator;段 B/C(流式 + 收尾)留在本文件,
 * 因它们共享 ReadableStream 的 controller / 累积文本等闭包变量,强拆会扯断耦合。
 */
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";
import { streamChat, streamChatWithTools } from "@/lib/stream";
import { resolveMcpServers } from "@/lib/mcp/registry";
import { extractArtifacts } from "@/lib/artifacts/extract";
import { extractMemories } from "@/lib/memory/extract";
import { maybeGenerateTitle } from "@/lib/conversation-title/service";
import { prepareChatContext } from "@/lib/chat/orchestrator";
import type { IRRequest } from "@/lib/providers/types";
import type { ReasoningLevel } from "@/db/types";

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

  // 续写模式:在指定 assistant 消息末尾继续生成。复用其 publicId 与所在行,
  // finally 改走 update;stream 只发新增 delta(前端追加到既有内容)。
  let isContinue = false;
  let continuePrefixText = "";
  let continueAssistantInternalId: string | null = null;
  let continueParentUserPublicId: string | null = null;
  if (body.continueFromPublicId) {
    const [contMsg] = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.publicId, body.continueFromPublicId))
      .limit(1);
    if (!contMsg || contMsg.conversationId !== body.conversationId) {
      return NextResponse.json({ error: "续写消息不存在或不属于该会话" }, { status: 400 });
    }
    if (contMsg.role !== "assistant") {
      return NextResponse.json({ error: "仅支持在 assistant 消息上续写" }, { status: 400 });
    }
    isContinue = true;
    continueAssistantInternalId = contMsg.id;
    continuePrefixText =
      typeof contMsg.content === "string" ? contMsg.content : String(contMsg.content ?? "");
    if (contMsg.parentId) {
      const [parentUser] = await db
        .select()
        .from(s.messages)
        .where(eq(s.messages.id, contMsg.parentId))
        .limit(1);
      continueParentUserPublicId = parentUser?.publicId ?? null;
    }
  }

  // user 消息:
  // - send 流程(无 userPublicId):生成并插入新 user 消息。
  // - edit/retry 流程(传入 userPublicId):跳过插入,复用既有的 user 消息。
  let userPublicId: string;
  if (isContinue) {
    // 续写沿用原 user 父消息,不插入新 user
    userPublicId = continueParentUserPublicId ?? body.userPublicId ?? "";
  } else if (body.userPublicId) {
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

  // ===== 段 A:上下文准备(抽到 orchestrator,纯输入→输出)=====
  const prepared = await prepareChatContext({
    userId: user.id,
    conversationId: body.conversationId,
    conv: { outputModeId: conv.outputModeId },
    userContent,
    model: body.model,
    messages: body.messages,
    fileIds: body.fileIds,
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

  // 会话级模型参数(用户在 toolbar 设置)覆盖默认值;未设置则沿用 prepareChatContext 的默认
  const composerParams = (conv.composerState as { temperature?: number; topP?: number; maxTokens?: number; reasoning?: ReasoningLevel } | null) ?? {};
  if (typeof composerParams.temperature === "number") irRequest.temperature = composerParams.temperature;
  if (typeof composerParams.topP === "number") irRequest.top_p = composerParams.topP;
  if (typeof composerParams.maxTokens === "number") irRequest.max_tokens = composerParams.maxTokens;
  if (composerParams.reasoning) irRequest.reasoning = composerParams.reasoning;

  const ctx = { userId: user.id, keyKind: null as null, source: "chat" as const };

  // 流式返回:text/event-stream,每条 text-delta 作为一行
  const encoder = new TextEncoder();
  // 标记会话为「生成中」(供侧栏转圈标识;在 finally 中清除)
  await db.update(s.conversations).set({ generating: true }).where(eq(s.conversations.id, body.conversationId));
  // 提前生成 assistant 消息 publicId:在流首帧回传给前端,使生成期间即可显示操作按钮;
  // finally 落库时复用同一标识。
  const assistantPublicId = isContinue ? body.continueFromPublicId! : crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      let assistantReasoning = "";
      let finished = false; // 正常收到 finish 事件才判 success,否则 interrupted
      // 回传本轮 user 消息的 publicId,供前端回填后支持编辑重发。
      // 续写模式下 user 沿用原消息,前端无需回填,跳过该帧。
      if (!isContinue) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "user_message", publicId: userPublicId })}\n\n`),
        );
      }
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
            finished = true;
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
        if (isContinue && continueAssistantInternalId) {
          // 续写:update 既有 assistant 行,prefix + 新增内容
          await db
            .update(s.messages)
            .set({
              content: continuePrefixText + assistantText,
              reasoning: assistantReasoning || null,
              status: finished ? "success" : "interrupted",
              processTrace: trace,
            })
            .where(eq(s.messages.id, continueAssistantInternalId));
        } else {
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
            status: finished ? "success" : "interrupted",
            processTrace: trace,
          });
        }

        // P1-B:抽取 artifact(代码块/Mermaid/SVG 等)并持久化。
        if (assistantText && !isContinue) {
          try {
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
        if (assistantText && !isContinue) {
          const recentMessages = [...body.messages, { role: "assistant", content: assistantText }]
            .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content ?? "") }));
          extractMemories(user.id, body.conversationId, recentMessages, body.model).catch(() => {});

          // 首条 user 消息触发标题自动生成(service 内判断仅默认标题才生成)。
          // 通过 onTitle 回调推送 title_updated 帧(fallback 和最终标题各一次),
          // 由前端 router.refresh 刷新会话列表。
          try {
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
