import { bootstrapDatabase } from "@nekusora/core/bootstrap";
import { validateEnv } from "@nekusora/core/env";
import {
  createGatewayGovernanceRepository,
  startGatewayGovernanceAggregate,
  startGatewayGovernanceReaper,
  type GovernanceReaperController,
} from "@nekusora/core/gateway-governance";
import { installGlobalErrorGuards } from "@nekusora/core/process-guards";
import { configureQueueProvider } from "@nekusora/core/queue";
import { closeDb } from "@nekusora/db";
import { closeQueue, getQueue } from "@nekusora/queue";
import { buildServer, closeGatewayResources } from "./server";

let server: ReturnType<typeof buildServer> | undefined;
let governanceReaper: GovernanceReaperController | undefined;

async function main(): Promise<void> {
  installGlobalErrorGuards();
  validateEnv();
  configureQueueProvider(getQueue);
  await bootstrapDatabase({ seedAdmin: false });

  const repository = await createGatewayGovernanceRepository();
  const reaper = startGatewayGovernanceReaper({
    repository,
    onFailure: (code) => console.error(`[gateway] 治理租约回收失败 code=${code}`),
  });
  const aggregate = startGatewayGovernanceAggregate({
    repository,
    onFailure: () => console.error("[gateway] 治理聚合刷新失败"),
  });
  governanceReaper = {
    stop: async () => {
      await Promise.all([reaper.stop(), aggregate.stop()]);
    },
  };
  server = buildServer({
    closeResources: () => closeGatewayResources(governanceReaper!),
  });
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
    await governanceReaper?.stop().catch(() => undefined);
    await Promise.allSettled([closeQueue(), closeDb()]);
  }
  process.exitCode = 1;
});
