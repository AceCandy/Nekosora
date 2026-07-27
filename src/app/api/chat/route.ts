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
import { and, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { withBestEffortTimeout } from "@/lib/best-effort";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";
import { streamChat, streamChatWithTools } from "@/lib/stream";
import { getChatUA } from "@/lib/system-settings/ua";
import { resolveMcpServers } from "@/lib/mcp/registry";
import { extractArtifacts } from "@/lib/artifacts/extract";
import { getQueue } from "@/lib/infra/queue";
import { writeFallbackTitle } from "@/lib/conversation-title/service";
import { dispatchConversationTitleJob } from "@/lib/conversation-title/dispatch";
import { prepareChatContext } from "@/lib/chat/orchestrator";
import {
  findConversationMessage,
  withConversationMessageWrite,
} from "@/lib/chat/message-reference";
import {
  createRunId,
  finalizeRun,
  heartbeatRun,
  irUsageToTokenUsage,
  recordToolCallResult,
  recordToolCallStart,
  resolveRunTerminalStatus,
  startRun,
} from "@/lib/chat/run-lifecycle";
import { redactErrorMessage } from "@/lib/redaction";
import type { IRRequest, IRUsage } from "@/lib/providers/types";
import type { ReasoningLevel } from "@/db/types";
import type { MessageRunMetadata } from "@/features/chat/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_HEARTBEAT_INTERVAL_MS = 30_000;

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
    continuePrefixText =
      typeof contMsg.content === "string" ? contMsg.content : String(contMsg.content ?? "");
    if (contMsg.parentId) {
      const parentUser = await findConversationMessage(db, s, body.conversationId, {
        id: contMsg.parentId as string,
      });
      if (parentUser?.role === "user") {
        continueParentUserInternalId = parentUser.id as string;
        continueParentUserPublicId = parentUser.publicId as string;
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
  if (isContinue) {
    if (!continueParentUserPublicId) {
      return NextResponse.json({ error: "续写消息缺少用户父消息" }, { status: 400 });
    }
    // 续写沿用原 user 父消息,不插入新 user
    userPublicId = continueParentUserPublicId;
    userMessageInternalId = continueParentUserInternalId;
  } else if (body.userPublicId) {
    const userMessage = await findConversationMessage(db, s, body.conversationId, {
      publicId: body.userPublicId,
    });
    if (!userMessage || userMessage.role !== "user") {
      return NextResponse.json({ error: "用户消息不存在或不属于当前会话" }, { status: 400 });
    }
    userPublicId = body.userPublicId;
    userMessageInternalId = userMessage.id as string;
  } else {
    userPublicId = crypto.randomUUID();
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
          })
          .returning({ id: s.messages.id });
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
    conv: { outputModeId: conv.outputModeId },
    userContent,
    model: body.model,
    modelId: body.modelId,
    messages: body.messages,
    branchLeafPublicId: isContinue ? body.continueFromPublicId! : userPublicId,
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

  const composerState = (conv.composerState as { reasoningByModelId?: Record<string, ReasoningLevel> } | null) ?? {};
  if (body.modelId && composerState.reasoningByModelId?.[body.modelId]) {
    irRequest.reasoning = composerState.reasoningByModelId[body.modelId];
  }

  const ctx = { userId: user.id, keyKind: null as null, source: "chat" as const };

  // 流式返回:text/event-stream,每条 text-delta 作为一行
  const encoder = new TextEncoder();
  // 流开始前落 runs(running);DB 失败不阻断后续流式生成。
  const runStarted = await startRun({
    runId,
    conversationId: body.conversationId,
    userId: user.id,
    platformModelName: body.model,
  });
  // 提前生成 assistant 消息 publicId:在流首帧回传给前端,使生成期间即可显示操作按钮;
  // finally 落库时复用同一标识。
  const assistantPublicId = isContinue ? body.continueFromPublicId! : crypto.randomUUID();
  // 客户端断开(刷新 / 关页 / HMR / req.signal abort)→ 中止上游生成,避免继续写已关闭 socket
  // 触发 Socket closed unexpectedly → uncaughtException 反复冲击 dev server。req.signal 在部分场景
  // 不可靠,由 ReadableStream.cancel() 兜底,二者都触发同一个 AbortController。
  const abortCtl = new AbortController();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatInFlight: Promise<void> | null = null;
  let heartbeatStopped = false;
  const stopHeartbeat = () => {
    heartbeatStopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
  const onRequestAbort = () => {
    stopHeartbeat();
    abortCtl.abort();
  };
  if (req.signal.aborted) {
    onRequestAbort();
  } else {
    req.signal.addEventListener("abort", onRequestAbort, { once: true });
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (runStarted && !heartbeatStopped && !abortCtl.signal.aborted) {
        heartbeatTimer = setInterval(() => {
          if (heartbeatStopped || abortCtl.signal.aborted || heartbeatInFlight) {
            return;
          }
          const pending = heartbeatRun(runId);
          heartbeatInFlight = pending;
          const clearInFlight = () => {
            if (heartbeatInFlight === pending) heartbeatInFlight = null;
          };
          void pending.then(clearInFlight, clearInFlight);
        }, RUN_HEARTBEAT_INTERVAL_MS);
        heartbeatTimer.unref();
      }
      // 客户端断开后 controller 处于已关闭态:统一经 safeEnqueue 写入,避免向已关闭流 enqueue 抛错。
      const safeEnqueue = (chunk: Uint8Array) => {
        if (abortCtl.signal.aborted) return;
        try {
          controller.enqueue(chunk);
        } catch {
          /* controller 已随客户端断开关闭,丢弃 */
        }
      };
      let assistantText = "";
      let assistantReasoning = "";
      let finished = false; // 正常收到 finish 事件才判 success,否则 interrupted/failed
      let sawStreamError = false;
      let persistenceFailed = false;
      let completionPersisted = false;
      let finalUsage: IRUsage | undefined;
      let durationMs: number | null = null;
      let completedAt: Date | null = null;
      // 回传本轮 user 消息的 publicId,供前端回填后支持编辑重发。
      // 续写模式下 user 沿用原消息,前端无需回填,跳过该帧。
      if (!isContinue) {
        safeEnqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "user_message", publicId: userPublicId })}\n\n`),
        );
      }
      // 回传本轮 assistant 占位消息的 publicId,供前端回填后无需刷新即可显示操作按钮。
      safeEnqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "assistant_message", publicId: assistantPublicId })}\n\n`),
      );
      // 如有联网搜索结果,发 search_result 事件供 UI 展示引用
      if (searchBundle?.hit) {
        safeEnqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "search_result", results: searchBundle.results })}\n\n`,
          ),
        );
      }
      // 如有 RAG 检索结果,先发一个 rag_search 事件供 UI 显示
      if (ragStatus) {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "rag_search", status: ragStatus })}\n\n`));
      }
      // 如触发了压缩,发 compact 事件
      if (compaction?.compacted) {
        safeEnqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "compact", strategy: compaction.strategy, level: compaction.fallbackLevel })}\n\n`,
          ),
        );
      }
      try {
        // P1-A:解析 MCP server。有可用工具则走 agent loop,否则普通 streamChat。
        const mcpServers = await resolveMcpServers(ctx).catch(() => []);
        const hasTools = mcpServers.some((sv) => sv.tools.length > 0);
        const chatUA = await getChatUA();
        // 同一 agent 多轮共享 runId(streamChatWithTools 透传给每轮 streamChat)。
        const gen = hasTools
          ? streamChatWithTools({
              ctx,
              request: irRequest,
              mcpServers,
              runId,
              cacheKey: body.conversationId,
              modelId: body.modelId,
              abortSignal: abortCtl.signal,
              userAgent: chatUA,
            })
          : streamChat({
              ctx,
              request: irRequest,
              runId,
              cacheKey: body.conversationId,
              modelId: body.modelId,
              abortSignal: abortCtl.signal,
              userAgent: chatUA,
            });
        for await (const ev of gen) {
          if (ev.type === "text-delta") {
            assistantText += ev.text;
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: ev.text })}\n\n`));
          } else if (ev.type === "reasoning-delta") {
            assistantReasoning += ev.text;
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "reasoning", text: ev.text })}\n\n`));
          } else if (ev.type === "finish") {
            finished = true;
            finalUsage = ev.usage;
          } else if (ev.type === "tool-call") {
            // 审计落库 best-effort(内部吞错);SSE 载荷保持兼容(仅 toolName/args)。
            await recordToolCallStart({
              runId,
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              args: ev.args,
            });
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", toolName: ev.toolName, args: ev.args })}\n\n`));
          } else if (ev.type === "tool-result") {
            await recordToolCallResult({
              runId,
              toolCallId: ev.toolCallId,
              result: ev.result,
              isError: ev.isError,
            });
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", toolName: ev.toolName, isError: ev.isError })}\n\n`));
          } else if (ev.type === "error") {
            sawStreamError = true;
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: ev.error, code: ev.code })}\n\n`));
          }
        }
      } catch (err) {
        // 客户端断开引发的中止不发 error 帧:客户端已不接收,且向已关闭流 enqueue 会抛。
        if (!abortCtl.signal.aborted) {
          sawStreamError = true;
          safeEnqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: redactErrorMessage(err, [], "内部错误") })}\n\n`),
          );
        }
      } finally {
        stopHeartbeat();
        try {
          const persisted = await withConversationMessageWrite(
            db,
            s,
            body.conversationId,
            user.id,
            async (tx) => {
              if (!userMessageInternalId) throw new Error("用户父消息已失效");
              const activeUserMessage = await findConversationMessage(
                tx,
                s,
                body.conversationId,
                { id: userMessageInternalId },
              );
              const activeUserContent =
                typeof activeUserMessage?.content === "string"
                  ? activeUserMessage.content
                  : String(activeUserMessage?.content ?? "");
              if (activeUserMessage?.role !== "user" || activeUserContent !== userContent) {
                throw new Error("用户父消息已失效或内容已变更");
              }

              if (sourceIdInternal) {
                const activeSource = await findConversationMessage(
                  tx,
                  s,
                  body.conversationId,
                  { id: sourceIdInternal },
                );
                if (!activeSource) throw new Error("源消息已失效");
              }

              if (isContinue && continueAssistantInternalId) {
                // 原内容参与条件写，避免两个并发续写互相覆盖。
                const [updated] = await tx
                  .update(s.messages)
                  .set({
                    content: continuePrefixText + assistantText,
                    reasoning: assistantReasoning || null,
                    status: finished ? "success" : "interrupted",
                    processTrace: trace,
                    runId,
                  })
                  .where(
                    and(
                      eq(s.messages.id, continueAssistantInternalId),
                      eq(s.messages.conversationId, body.conversationId),
                      eq(s.messages.role, "assistant"),
                      isNull(s.messages.deletedAt),
                      eq(s.messages.content, continuePrefixText),
                    ),
                  )
                  .returning({ id: s.messages.id });
                if (!updated) throw new Error("续写消息已失效或内容已变更");
                return;
              }

              // 持久化 assistant 消息;parentId 指向本轮 user 消息;附 process_trace + runId
              await tx.insert(s.messages).values({
                conversationId: body.conversationId,
                publicId: assistantPublicId,
                parentId: userMessageInternalId,
                runId,
                role: "assistant",
                content: assistantText,
                reasoning: assistantReasoning || null,
                status: finished ? "success" : "interrupted",
                processTrace: trace,
              });
            },
          );
          if (persisted === null) throw new Error("会话已失效或无权访问");

          // P1-B:抽取 artifact(代码块/Mermaid/SVG 等)并持久化。
          if (assistantText && !isContinue) {
            try {
              const { artifacts: parsed } = extractArtifacts(assistantText);
              if (parsed.length > 0) {
                const assistantMsgRow = await findConversationMessage(
                  db,
                  s,
                  body.conversationId,
                  { publicId: assistantPublicId },
                );
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

          // 更新会话时间；生成活动状态由 fresh running runs 动态派生。
          await db
            .update(s.conversations)
            .set({ updatedAt: new Date() })
            .where(eq(s.conversations.id, body.conversationId));

          // 异步提取记忆(入队 pg-boss,由 worker 消费,抗重启)。
          if (assistantText && !isContinue) {
            const recentMessages = [...body.messages, { role: "assistant", content: assistantText }]
              .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content ?? "") }));
            getQueue()
              .then((q) =>
                q.send("memory-extract", {
                  userId: user.id,
                  conversationId: body.conversationId,
                  recentMessages,
                }),
              )
              .catch((error) =>
                console.error(
                  "[chat] memory-extract enqueue failed:",
                  redactErrorMessage(error),
                ),
              );
          }

          completedAt = new Date();
          durationMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
          completionPersisted = true;
        } catch (err) {
          persistenceFailed = true;
          // 收尾失败仍尽力更新时间；活动 run 会由终态或租约过期收敛。
          try {
            await withBestEffortTimeout(() =>
              db
                .update(s.conversations)
                .set({ updatedAt: new Date() })
                .where(eq(s.conversations.id, body.conversationId)),
            );
          } catch {
            /* DB 不可用时无法继续收敛 */
          }
          if (!abortCtl.signal.aborted) {
            safeEnqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", error: redactErrorMessage(err, [], "收尾持久化失败") })}\n\n`,
              ),
            );
          }
        } finally {
          // 无论消息落库是否成功,都必须把 runs 从 running 收敛到终态。
          stopHeartbeat();
          const tokenUsage = irUsageToTokenUsage(finalUsage);
          await finalizeRun({
            runId,
            status: resolveRunTerminalStatus({
              finished,
              aborted: abortCtl.signal.aborted,
              sawError: sawStreamError,
              persistenceFailed,
            }),
            tokenUsage,
            durationMs,
            completedAt,
          });
          // DONE 是可靠完成信号：必要消息持久化与 run 终结处理均已完成。
          if (completionPersisted && completedAt && durationMs !== null) {
            const metadata: MessageRunMetadata = {
              model: body.model,
              durationMs,
              completedAt: completedAt.toISOString(),
            };
            if (tokenUsage) metadata.tokenUsage = tokenUsage;
            safeEnqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "finish", metadata })}\n\n`,
              ),
            );
            safeEnqueue(encoder.encode("data: [DONE]\n\n"));
          }
          req.signal.removeEventListener("abort", onRequestAbort);
          try {
            controller.close();
          } catch {
            /* 客户端断开已取消流,忽略重复关闭 */
          }
        }
      }
    },
    // 客户端断开时触发:中止上游生成(req.signal 在部分场景不可靠,cancel 兜底)。
    cancel() {
      stopHeartbeat();
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
