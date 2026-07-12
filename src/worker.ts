/**
 * 独立 worker 进程 —— 消费 pg-boss 队列(PostgreSQL)。
 *
 * 用途:文件处理流水线(extract → chunk → embed → rag_ready)。
 *
 * 启动:pnpm worker  (生产环境用 pm2/systemd 守护)
 */
async function main() {
  const { getQueue } = await import("@/lib/infra/queue");
  const { processFile } = await import("@/lib/rag/process");
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
