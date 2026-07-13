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
 * bootstrap 全程在 Node server 进程跑:连通性探测 + 自动建表(migrate)+ 首个管理员。
 * **DB 连接失败 / 建表失败 / 管理员创建失败均会 throw 阻断启动** ——
 * 让 DB 状态异常在启动阶段尽早暴露,避免"启动了但运行时才报错"。
 * 仅 pgvector 扩展创建保留 warn(部分托管 PG 禁建扩展,不影响核心)。
 *
 * pg-boss 队列初始化仍由独立 worker 进程(src/worker.ts)负责,不在本文件做。
 */
export async function register(): Promise<void> {
  // 防线 1:Edge 版本 instrumentation 直接 return,不跑任何 DB 逻辑。
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  // 尽早装上进程级兜底(在 DB bootstrap 之前),防上游 socket 类噪声冲击 Next dev 进程。
  // 用变量路径 import 阻断 Edge 编译静态预扫描 —— 否则 process.on 会被判为 Edge 不支持而编译失败
  // (与下方 bootstrap 同一手法;实现见 src/lib/infra/process-guards.ts)。
  const guardPath = "@/lib/infra/process-guards";
  const { installGlobalErrorGuards } = await import(guardPath);
  installGlobalErrorGuards();

  const hasRedis = !!process.env.REDIS_URL;
  console.log(
    `[instrumentation] Nekusora 启动 | DB=pg | Redis=${hasRedis ? "on" : "off(memory)"} | ` +
      `Queue=需运行 pnpm worker`,
  );

  // 防线 2:变量路径 import,阻止 Turbopack 静态预扫描依赖图。
  const bootstrapPath = "@/lib/infra/db/bootstrap";
  const { bootstrapDatabase } = await import(bootstrapPath);
  // DB 连接/建表/管理员失败均会 throw,直接阻断启动(bootstrap 内部已封装错误信息)。
  await bootstrapDatabase();
  console.log("[instrumentation] ✅ 数据库 bootstrap 完成");
}
