import { validateEnv } from "@nekusora/core/env";

function configureDatabasePool(): void {
  const value = process.env.WORKER_DB_POOL_MAX ?? process.env.DB_POOL_MAX ?? "5";
  const poolMax = Number(value);
  if (!Number.isInteger(poolMax) || poolMax < 1) {
    throw new Error("WORKER_DB_POOL_MAX 非法，期望正整数");
  }
  process.env.DB_POOL_MAX = String(poolMax);
}

export async function startWorker(): Promise<void> {
  validateEnv();
  configureDatabasePool();

  const [
    { bootstrapDatabase },
    { configureQueueProvider },
    { closeDb },
    queueModule,
    { WORKER_DEFINITIONS },
    { createWorkerRuntime },
    { getWorkerHealthOptions, startHealthServer },
  ] = await Promise.all([
    import("@nekusora/core/bootstrap"),
    import("@nekusora/core/queue"),
    import("@nekusora/db"),
    import("@nekusora/queue"),
    import("@nekusora/core/worker/definitions"),
    import("@nekusora/core/worker/runtime"),
    import("./health"),
  ]);

  configureQueueProvider(queueModule.getQueue);
  const health = await startHealthServer(getWorkerHealthOptions());
  let runtimeOwnsResources = false;
  try {
    await bootstrapDatabase();
    const queue = await queueModule.getQueue();
    const runtime = createWorkerRuntime({
      queue,
      definitions: WORKER_DEFINITIONS,
      process,
      onStateChange: health.setState,
      closeResources: async () => {
        const results = await Promise.allSettled([closeDb(), health.close()]);
        if (results.some((result) => result.status === "rejected")) {
          throw new Error("Worker 进程资源关闭失败");
        }
      },
    });
    runtimeOwnsResources = true;
    await runtime.start();
  } catch (error) {
    if (!runtimeOwnsResources) {
      await Promise.allSettled([queueModule.closeQueue(), closeDb(), health.close()]);
    }
    throw error;
  }
}

if (!process.env.VITEST) {
  void startWorker().catch(() => {
    console.error("[worker] startup failed");
    process.exit(1);
  });
}
