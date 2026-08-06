import { randomBytes } from "node:crypto";
import type { JobOutcome } from "@nekusora/contracts/queue";

const DATABASE_PREFIX = "nekusora_queue_lifecycle_test_";
const HANDLER_START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_LOWER_BOUND_MS = 29_000;
let failureStage = "validate-environment";

function quoteDatabaseName(name: string): string {
  if (!new RegExp(`^${DATABASE_PREFIX}[0-9a-f]{16}$`).test(name)) {
    throw new Error("拒绝操作非队列生命周期测试数据库");
  }
  return `"${name}"`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("等待 queue handler 超时")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function classifyError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const code = "code" in error && typeof error.code === "string"
    && /^[A-Z0-9_]{1,32}$/u.test(error.code)
    ? error.code
    : "no-code";
  const frame = error.stack?.match(
    /(?:src|scripts|node_modules)\/[A-Za-z0-9_./-]+:\d+:\d+/u,
  )?.[0] ?? "no-frame";
  return `${error.name}/${code}/${frame}`;
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("未配置 DATABASE_URL");
  const parsedAdminUrl = new URL(adminUrl);
  if (parsedAdminUrl.protocol !== "postgres:" && parsedAdminUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL 不是 PostgreSQL URL");
  }

  const databaseName = `${DATABASE_PREFIX}${randomBytes(8).toString("hex")}`;
  const quotedDatabaseName = quoteDatabaseName(databaseName);
  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: adminUrl });
  let inspection: InstanceType<typeof pg.Client> | null = null;
  let queue: Awaited<ReturnType<typeof import("@nekusora/queue")["getQueue"]>> | null = null;
  let created = false;
  const cleanGate = deferred<JobOutcome>();
  const timeoutGate = deferred<JobOutcome>();

  try {
    failureStage = "connect-admin";
    await admin.connect();
    failureStage = "create-database";
    await admin.query(`CREATE DATABASE ${quotedDatabaseName}`);
    created = true;

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = testUrl.toString();
    inspection = new pg.Client({ connectionString: testUrl.toString() });
    failureStage = "connect-inspection";
    await inspection.connect();

    failureStage = "load-queue";
    const queueModule = await import("@nekusora/queue");
    const { FILE_PROCESS_QUEUE } = await import("@nekusora/contracts/queue");
    queue = await queueModule.getQueue();

    failureStage = "clean-register";
    const cleanStarted = deferred<void>();
    await queue.work(FILE_PROCESS_QUEUE, async () => {
      cleanStarted.resolve();
      return cleanGate.promise;
    });
    failureStage = "clean-send";
    const cleanJobId = await queue.send(FILE_PROCESS_QUEUE, { fileId: "clean-drain" });
    failureStage = "clean-handler-start";
    await withTimeout(cleanStarted.promise, HANDLER_START_TIMEOUT_MS);
    setTimeout(() => cleanGate.resolve("completed"), 100);
    failureStage = "clean-stop";
    await queue.stop();
    failureStage = "clean-state";
    const cleanResult = await inspection.query(
      "SELECT state FROM pgboss.job WHERE id = $1",
      [cleanJobId],
    ) as { rows: Array<{ state: string }> };
    requireCondition(cleanResult.rows[0]?.state === "completed", "clean drain 未完成 job");
    console.log("[queue-lifecycle-pg-test] clean drain passed");

    failureStage = "timeout-register";
    const timeoutStarted = deferred<void>();
    await queue.work(FILE_PROCESS_QUEUE, async () => {
      timeoutStarted.resolve();
      return timeoutGate.promise;
    });
    failureStage = "timeout-send";
    const timeoutJobId = await queue.send(FILE_PROCESS_QUEUE, { fileId: "timeout-drain" });
    failureStage = "timeout-handler-start";
    await withTimeout(timeoutStarted.promise, HANDLER_START_TIMEOUT_MS);
    failureStage = "timeout-stop";
    const stopStartedAt = globalThis.performance.now();
    let stopError: unknown;
    try {
      await queue.stop();
    } catch (error) {
      stopError = error;
    }
    const stopElapsed = globalThis.performance.now() - stopStartedAt;
    requireCondition(
      stopError instanceof Error
        && stopError.message === queueModule.QUEUE_DRAIN_TIMEOUT_MESSAGE,
      "timeout drain 未返回稳定失败",
    );
    requireCondition(
      stopElapsed >= STOP_TIMEOUT_LOWER_BOUND_MS,
      "timeout drain 在 deadline 前返回",
    );
    failureStage = "timeout-state";
    const timeoutResult = await inspection.query(
      "SELECT state FROM pgboss.job WHERE id = $1",
      [timeoutJobId],
    ) as { rows: Array<{ state: string }> };
    requireCondition(
      timeoutResult.rows[0]?.state === "retry"
        || timeoutResult.rows[0]?.state === "failed",
      "timeout job 未进入 retry/failed",
    );
    console.log("[queue-lifecycle-pg-test] timeout drain passed");
  } finally {
    cleanGate.resolve("noop");
    timeoutGate.resolve("noop");
    await queue?.stop().catch(() => undefined);
    await inspection?.end().catch(() => undefined);
    process.env.DATABASE_URL = adminUrl;
    try {
      if (created) {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName],
        ).catch(() => undefined);
        await admin.query(`DROP DATABASE ${quoteDatabaseName(databaseName)} WITH (FORCE)`);
      }
    } finally {
      await admin.end().catch(() => undefined);
    }
  }
}

void main().catch((error) => {
  console.error(
    `[queue-lifecycle-pg-test] failed at ${failureStage} (${classifyError(error)})`,
  );
  process.exitCode = 1;
});
