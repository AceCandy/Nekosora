import { createServer, type Server } from "node:http";

export type WorkerHealthState = "starting" | "ready" | "stopping" | "stopped";

export interface WorkerHealthController {
  readonly port: number;
  setState(state: WorkerHealthState): void;
  close(): Promise<void>;
}

function json(statusCode: number, body: object): [number, string] {
  return [statusCode, JSON.stringify(body)];
}

export async function startHealthServer(options: {
  host: string;
  port: number;
}): Promise<WorkerHealthController> {
  let state: WorkerHealthState = "starting";
  let closePromise: Promise<void> | null = null;
  const server: Server = createServer((request, response) => {
    const result = request.url === "/healthz"
      ? json(200, { status: "ok" })
      : request.url === "/healthz/ready"
        ? state === "ready"
          ? json(200, { status: "ready" })
          : json(503, { status: "unready" })
        : json(404, { status: "not_found" });
    response.writeHead(result[0], { "content-type": "application/json" });
    response.end(result[1]);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Worker 健康监听地址不可用");
  }

  return {
    port: address.port,
    setState(nextState) {
      state = nextState;
    },
    close() {
      closePromise ??= new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      return closePromise;
    },
  };
}

export function getWorkerHealthOptions(): { host: string; port: number } {
  const host = process.env.WORKER_HEALTH_HOST ?? "0.0.0.0";
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 4001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("WORKER_HEALTH_PORT 非法，期望 1-65535 的整数");
  }
  return { host, port };
}
