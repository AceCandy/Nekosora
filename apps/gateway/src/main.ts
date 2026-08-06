import { bootstrapDatabase } from "@nekusora/core/bootstrap";
import { validateEnv } from "@nekusora/core/env";
import { installGlobalErrorGuards } from "@nekusora/core/process-guards";
import { configureQueueProvider } from "@nekusora/core/queue";
import { closeDb } from "@nekusora/db";
import { closeQueue, getQueue } from "@nekusora/queue";
import { buildServer } from "./server";

let server: ReturnType<typeof buildServer> | undefined;

async function main(): Promise<void> {
  installGlobalErrorGuards();
  validateEnv();
  configureQueueProvider(getQueue);
  await bootstrapDatabase({ seedAdmin: false });

  server = buildServer();
  const port = Number(process.env.GATEWAY_PORT ?? 4000);
  const host = process.env.GATEWAY_HOST ?? "0.0.0.0";

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("GATEWAY_PORT 非法，期望 1-65535 的整数");
  }

  await server.listen({ host, port });
  console.log(`[gateway] listening on http://${host}:${port}`);

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    shutdownPromise ??= server?.close().catch(() => {
      process.exitCode = 1;
    }) ?? Promise.resolve();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch(async () => {
  console.error("[gateway] 启动失败");
  if (server) {
    await server.close().catch(() => undefined);
  } else {
    await Promise.allSettled([closeQueue(), closeDb()]);
  }
  process.exitCode = 1;
});
