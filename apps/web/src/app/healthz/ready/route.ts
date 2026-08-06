/**
 * 就绪探针 —— GET /healthz/ready
 *
 * 检查 Web 自身依赖是否可用（DB 连接 / Storage driver）。
 * 任一关键检查失败返回 503,Kubernetes/Docker 不向该实例转发流量。
 *
 * 检查项有超时保护(单项 2s),避免探针阻塞。
 */
import { NextResponse } from "next/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { getStorage } from "@/lib/infra/storage";
import { getEnvInfo } from "@/lib/infra/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = string | { available: boolean } | "error";

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    p,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ]);
}

export async function GET() {
  const env = getEnvInfo();

  const dbCheck = await withTimeout(
    (async (): Promise<CheckResult> => {
      try {
        const db = await getDb();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).execute("select 1");
        return "ok";
      } catch {
        return "error";
      }
    })(),
    2000,
  );

  const storageCheck = await withTimeout(
    (async (): Promise<CheckResult> => {
      try {
        const s = await getStorage();
        return s.kind;
      } catch {
        return "error";
      }
    })(),
    2000,
  );

  const checks = {
    db: dbCheck,
    storage: storageCheck,
    redis: env.hasRedis,
  };

  // Queue 由独立 Worker 探测；Web 仅以自身必要的 DB 为就绪条件。
  const ready = dbCheck === "ok";

  return NextResponse.json(
    {
      status: ready ? "ready" : "unready",
      checks,
      ts: Date.now(),
    },
    { status: ready ? 200 : 503 },
  );
}

// getSchema 静态引用保持(部分 lint 配置会检测未用 import,这里实际通过 getDb 间接用 schema)。
void getSchema;
