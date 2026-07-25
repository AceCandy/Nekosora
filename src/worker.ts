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
async function main() {
  const { getQueue } = await import("@/lib/infra/queue");
  const { processFile } = await import("@/lib/rag/process");
  const { extractMemories } = await import("@/lib/memory/extract");
  const { generateConversationTitle } = await import("@/lib/conversation-title/service");
  const queue = await getQueue();
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

  // 优雅关闭
  const shutdown = async () => {
    console.log("[worker] 正在关闭…");
    await queue.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[worker] 启动失败:", e);
  process.exit(1);
});
