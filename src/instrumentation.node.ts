/**
 * Node server 启动初始化:安装进程守卫、校验环境并完成数据库 bootstrap。
 * DB 连接、迁移或管理员初始化失败时应阻断启动;pgvector 初始化失败由 bootstrap 自行降级。
 */
export async function registerNodeInstrumentation(): Promise<void> {
  const { installGlobalErrorGuards } = await import("./lib/infra/process-guards");
  installGlobalErrorGuards();

  const { validateEnv } = await import("./lib/infra/env");
  validateEnv();

  const hasRedis = !!process.env.REDIS_URL;
  console.log(
    `[instrumentation] Nekusora 启动 | DB=pg | Redis=${hasRedis ? "on" : "off(memory)"} | ` +
      `Queue=需运行 pnpm worker`,
  );

  const { bootstrapDatabase } = await import("./lib/infra/db/bootstrap");
  await bootstrapDatabase();
  console.log("[instrumentation] ✅ 数据库 bootstrap 完成");
}
