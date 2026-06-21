/**
 * Next.js Instrumentation —— 在 Node server 进程启动时执行一次。
 *
 * 仅做轻量日志。pg-boss 队列初始化不在此处做 —— 它由独立的 worker 进程
 * (src/worker.ts)负责,避免 Edge instrumentation 编译时把 pg-boss → pg 拉入
 * (util/types 在 Turbopack bundler 下解析失败)。
 */
export async function register(): Promise<void> {
  if (typeof window !== "undefined") return;

  const dialect = process.env.DB_DIALECT ?? (process.env.DATABASE_URL ? "pg" : "sqlite");
  const hasRedis = !!process.env.REDIS_URL;
  console.log(
    `[instrumentation] Nekusora 启动 | DB=${dialect} | Redis=${hasRedis ? "on" : "off(memory)"} | ` +
      `Queue=${dialect === "pg" ? "需运行 pnpm worker" : "disabled(sqlite)"}`,
  );
}
