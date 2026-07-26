/**
 * 独立 worker 进程 —— 消费 pg-boss 队列(PostgreSQL)。
 *
 * 用途:
 *   - 文件处理流水线(extract → chunk → embed → rag_ready)
 *   - 记忆提取(对话流结束后从最近 N 轮提取偏好/事实;原 /api/chat 收尾副作用,入队抗重启)
 *   - 会话标题生成(首条消息 fallback 后异步生成最终标题)
 *
 * 启动:pnpm worker  (生产环境用 pm2/systemd 守护)
 */
interface WorkerRuntime {
  on(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): unknown;
  exit(code: number): unknown;
}

export async function startWorker(runtime: WorkerRuntime = process): Promise<void> {
  const { getQueue } = await import("@/lib/infra/queue");
  const { processFile } = await import("@/lib/rag/process");
  const { startFileProcessingRecovery } = await import("@/lib/rag/recovery");
  const { extractMemories } = await import("@/lib/memory/extract");
  const { generateConversationTitle } = await import("@/lib/conversation-title/service");
  const queue = await getQueue();
  let stopRecovery: (() => Promise<void>) | null = null;
  try {
    await queue.start();
    console.log("[worker] pg-boss 已启动,等待任务…");

    // 文件处理流水线:extract → chunk → embed → rag_ready
    await queue.work<{ fileId: string; storagePath: string; mime: string }>(
      "file-process",
      async (data) => {
        console.log("[worker] file-process:", data.fileId);
        await processFile(data.fileId, data.storagePath, data.mime);
      },
    );
    console.log("[worker] 已注册 file-process handler");

    // 记忆提取:LLM 抽取 + 向量去重 + 写库(extractMemories 内部已兜底,失败静默;10 分钟/用户频率保护)
    await queue.work<{
      userId: string;
      conversationId: string;
      recentMessages: { role: string; content: string }[];
      model?: string;
    }>("memory-extract", async (data) => {
      console.log("[worker] memory-extract:", data.userId);
      await extractMemories(data.userId, data.conversationId, data.recentMessages, data.model);
    });
    console.log("[worker] 已注册 memory-extract handler");

    // 会话标题：读取任务执行时的模型配置，条件更新保护用户手动改名。
    await queue.work<import("@/lib/conversation-title/service").ConversationTitleJob>(
      "conversation-title",
      async (data) => {
        console.log("[worker] conversation-title:", data.conversationId);
        await generateConversationTitle(data);
      },
    );
    console.log("[worker] 已注册 conversation-title handler");

    stopRecovery = startFileProcessingRecovery();

    // 优雅关闭
    const recoveryStop = stopRecovery;
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = () => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        console.log("[worker] 正在关闭…");
        let failed = false;
        try {
          await recoveryStop();
        } catch {
          failed = true;
          console.error("[worker] 文件恢复调度停止失败");
        }
        try {
          await queue.stop();
        } catch {
          failed = true;
          console.error("[worker] 队列停止失败");
        }
        runtime.exit(failed ? 1 : 0);
      })();
      return shutdownPromise;
    };
    runtime.on("SIGINT", shutdown);
    runtime.on("SIGTERM", shutdown);
  } catch (error) {
    if (stopRecovery) {
      try {
        await stopRecovery();
      } catch {
        console.error("[worker] 启动失败后无法停止文件恢复调度");
      }
    }
    try {
      await queue.stop();
    } catch {
      console.error("[worker] 启动失败后无法停止队列");
    }
    throw error;
  }
}

if (!process.env.VITEST) {
  startWorker().catch((e) => {
    console.error("[worker] 启动失败:", e);
    process.exit(1);
  });
}
