/**
 * Next.js Instrumentation —— 在进程启动时执行一次。
 *
 * ⚠️ 关键约束:Next 15 会把本文件同时编译成 **Node 版本**和 **Edge 版本**。
 * Edge 编译时,Turbopack 会静态预扫描本文件里所有 import(含动态 await import)
 * 的依赖图。bootstrap → drizzle migrator → pg → require('util/types'),
 * 在 Edge runtime 不存在 → 编译失败。
 *
 * 故两道防线:
 *   1. process.env.NEXT_RUNTIME !== "nodejs" 时直接 return(Edge 版本啥也不干)。
 *   2. 用变量构造 import 路径,阻止 bundler 静态预扫描:
 *        const p = "@/lib/infra/db/bootstrap"; await import(p);
 *      —— 这是 webpack/Turbopack 识别的"不要分析这个动态 import"信号。
 *
 * bootstrap 全程在 Node server 进程跑(建表/迁移 + 首个管理员)。
 * 失败则 throw,硬阻断启动,让"启动了但用不了"的问题在启动阶段就暴露。
 *
 * pg-boss 队列初始化仍由独立 worker 进程(src/worker.ts)负责,不在本文件做。
 */
export async function register(): Promise<void> {
  // 防线 1:Edge 版本 instrumentation 直接 return,不跑任何 DB 逻辑。
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const dialect = process.env.DB_DIALECT ?? (process.env.DATABASE_URL ? "pg" : "sqlite");
  const hasRedis = !!process.env.REDIS_URL;
  console.log(
    `[instrumentation] Nekusora 启动 | DB=${dialect} | Redis=${hasRedis ? "on" : "off(memory)"} | ` +
      `Queue=${dialect === "pg" ? "需运行 pnpm worker" : "disabled(sqlite)"}`,
  );

  try {
    // 防线 2:变量路径 import,阻止 Turbopack 静态预扫描依赖图。
    const bootstrapPath = "@/lib/infra/db/bootstrap";
    const { bootstrapDatabase } = await import(bootstrapPath);
    await bootstrapDatabase();
    console.log("[instrumentation] ✅ 数据库就绪(表已建/迁移,管理员已确认)");
  } catch (e) {
    console.error("[instrumentation] ❌ 数据库 bootstrap 失败:", e);
    throw e; // 硬阻断:让 Next 启动失败可见
  }
}
