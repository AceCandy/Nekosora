/** 独立 pg-boss worker 入口；领域注册与生命周期由 worker runtime 统一拥有。 */
interface WorkerProcess {
  on(
    signal: "SIGINT" | "SIGTERM",
    handler: () => void | Promise<void>,
  ): unknown;
  exit(code: number): unknown;
}

export async function startWorker(runtimeProcess: WorkerProcess = process): Promise<void> {
  const envPath = "@/lib/infra/env";
  const { validateEnv } = await import(envPath) as typeof import("@/lib/infra/env");
  validateEnv();

  const queuePath = "@/lib/infra/queue";
  const definitionsPath = "@/lib/worker/definitions";
  const runtimePath = "@/lib/worker/runtime";
  const [queueModule, definitionsModule, runtimeModule] = await Promise.all([
    import(queuePath) as Promise<typeof import("@/lib/infra/queue")>,
    import(definitionsPath) as Promise<typeof import("@/lib/worker/definitions")>,
    import(runtimePath) as Promise<typeof import("@/lib/worker/runtime")>,
  ]);
  const queue = await queueModule.getQueue();
  const runtime = runtimeModule.createWorkerRuntime({
    queue,
    definitions: definitionsModule.WORKER_DEFINITIONS,
    process: runtimeProcess,
  });
  await runtime.start();
}

if (!process.env.VITEST) {
  startWorker().catch(() => {
    console.error("[worker] startup failed");
    process.exit(1);
  });
}
