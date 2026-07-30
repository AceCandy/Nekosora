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
  const envPath = "@/lib/infra/env";
  const { validateEnv } = await import(envPath);
  validateEnv();

  const { getQueue } = await import("@/lib/infra/queue");
  const { processFile } = await import("@/lib/rag/processing-coordinator");
  const { startFileProcessingRecovery } = await import("@/lib/rag/recovery");
  const { processMemoryExtractionJob } = await import("@/lib/memory/jobs");
  const { startMemoryExtractionRecovery } = await import("@/lib/memory/dispatch");
  const { generateConversationTitle } = await import("@/lib/conversation-title/service");
  const { startConversationTitleRecovery } = await import("@/lib/conversation-title/dispatch");
  const queue = await getQueue();
  let stopFileRecovery: (() => Promise<void>) | null = null;
  let stopMemoryRecovery: (() => Promise<void>) | null = null;
  let stopTitleRecovery: (() => Promise<void>) | null = null;
  try {
    await queue.start();
    console.log("[worker] pg-boss 已启动,等待任务…");

    // 文件处理流水线:extract → chunk → embed → rag_ready
    await queue.work<{ fileId: string; storagePath: string; mime: string }>(
      "file-process",
      async (data) => {
        console.log("[worker] file-process:", data.fileId);
        await processFile(data.fileId);
      },
    );
    console.log("[worker] 已注册 file-process handler");

    // 记忆提取：只消费 durable intent id，业务完成后由 service 删除对应 row。
    await queue.work<{ id: string }>("memory-extract", async (data) => {
      console.log("[worker] memory-extract:", data.id);
      await processMemoryExtractionJob(data.id);
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

    stopFileRecovery = startFileProcessingRecovery();
    stopMemoryRecovery = startMemoryExtractionRecovery();
    stopTitleRecovery = startConversationTitleRecovery();

    // 优雅关闭
    const fileRecoveryStop = stopFileRecovery;
    const memoryRecoveryStop = stopMemoryRecovery;
    const titleRecoveryStop = stopTitleRecovery;
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = () => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        console.log("[worker] 正在关闭…");
        let failed = false;
        try {
          await titleRecoveryStop();
        } catch {
          failed = true;
          console.error("[worker] 标题恢复调度停止失败");
        }
        try {
          await memoryRecoveryStop();
        } catch {
          failed = true;
          console.error("[worker] 记忆恢复调度停止失败");
        }
        try {
          await fileRecoveryStop();
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
    if (stopTitleRecovery) {
      try {
        await stopTitleRecovery();
      } catch {
        console.error("[worker] 启动失败后无法停止标题恢复调度");
      }
    }
    if (stopMemoryRecovery) {
      try {
        await stopMemoryRecovery();
      } catch {
        console.error("[worker] 启动失败后无法停止记忆恢复调度");
      }
    }
    if (stopFileRecovery) {
      try {
        await stopFileRecovery();
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
