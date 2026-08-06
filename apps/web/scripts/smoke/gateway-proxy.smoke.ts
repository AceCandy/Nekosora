import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildGatewayRewrites } from "../../src/gateway-rewrites";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "../..");
const repoRoot = resolve(webRoot, "../..");
const require = createRequire(import.meta.url);

interface UpstreamRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("listener address unavailable"));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function waitForNext(baseUrl: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next 提前退出(${child.exitCode}):\n${output().slice(-4000)}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Listener is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Next 启动超时:\n${output().slice(-4000)}`);
}

const requests: UpstreamRequest[] = [];
const upstream = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  requests.push({
    method: request.method ?? "GET",
    url: request.url ?? "/",
    headers: request.headers,
    body: Buffer.concat(chunks),
  });

  if (request.url === "/api/files/file-1") {
    response.writeHead(206, {
      "Content-Type": "application/octet-stream",
      "Content-Range": "bytes 2-4/10",
      "Accept-Ranges": "bytes",
    });
    response.end("234");
    return;
  }
  if (request.url === "/v1/chat/completions") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    });
    response.write("data: {\"ok\":true}\n\n");
    response.end("data: [DONE]\n\n");
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});

let fixture = "";
let nextProcess: ChildProcess | undefined;
try {
  const upstreamPort = await listen(upstream);
  const nextPortProbe = createServer();
  const nextPort = await listen(nextPortProbe);
  await closeServer(nextPortProbe);
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
  const nextUrl = `http://127.0.0.1:${nextPort}`;
  const rewrites = buildGatewayRewrites(upstreamUrl);
  assert(!Array.isArray(rewrites));

  fixture = await mkdtemp(join(tmpdir(), "nekusora-gateway-proxy-"));
  await mkdir(join(fixture, "app"));
  await writeFile(
    join(fixture, "next.config.mjs"),
    `export default { async rewrites() { return ${JSON.stringify(rewrites)}; } };\n`,
  );
  await writeFile(
    join(fixture, "app", "page.tsx"),
    "export default function Page() { return <main>proxy smoke</main>; }\n",
  );
  await symlink(join(webRoot, "node_modules"), join(fixture, "node_modules"), "dir");

  let nextOutput = "";
  nextProcess = spawn(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "dev", fixture, "--webpack", "-p", String(nextPort)],
    {
      cwd: fixture,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nextProcess.stdout?.on("data", (chunk) => { nextOutput += String(chunk); });
  nextProcess.stderr?.on("data", (chunk) => { nextOutput += String(chunk); });
  await waitForNext(nextUrl, nextProcess, () => nextOutput);

  const chat = await fetch(`${nextUrl}/api/chat`, {
    method: "POST",
    headers: {
      authorization: "Bearer sk-proxy-smoke",
      cookie: "session=proxy-smoke",
      "content-type": "application/json",
    },
    body: "{\"message\":\"hello\"}",
  });
  assert.equal(chat.url, `${nextUrl}/api/chat`);
  assert.deepEqual(await chat.json(), { ok: true });

  const form = new FormData();
  form.set("file", new File(["upload-body"], "smoke.txt", { type: "text/plain" }));
  const upload = await fetch(`${nextUrl}/api/upload`, {
    method: "POST",
    headers: { cookie: "session=proxy-smoke" },
    body: form,
  });
  assert.equal(upload.status, 200);

  const file = await fetch(`${nextUrl}/api/files/file-1`, {
    headers: { cookie: "session=proxy-smoke", range: "bytes=2-4" },
  });
  assert.equal(file.status, 206);
  assert.equal(file.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await file.text(), "234");

  const stream = await fetch(`${nextUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer sk-proxy-smoke",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(stream.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(await stream.text(), "data: {\"ok\":true}\n\ndata: [DONE]\n\n");

  const chatUpstream = requests.find((item) => item.url === "/api/chat");
  assert.equal(chatUpstream?.headers.cookie, "session=proxy-smoke");
  assert.equal(chatUpstream?.headers.authorization, "Bearer sk-proxy-smoke");
  assert.equal(chatUpstream?.body.toString(), "{\"message\":\"hello\"}");

  const uploadUpstream = requests.find((item) => item.url === "/api/upload");
  assert.match(String(uploadUpstream?.headers["content-type"]), /^multipart\/form-data; boundary=/);
  assert.match(uploadUpstream?.body.toString() ?? "", /upload-body/);

  const fileUpstream = requests.find((item) => item.url === "/api/files/file-1");
  assert.equal(fileUpstream?.headers.range, "bytes=2-4");

  const proxiedRequestCount = requests.length;
  await stopChild(nextProcess);
  nextProcess = undefined;
  await rm(join(fixture, ".next"), { recursive: true, force: true });
  await writeFile(
    join(fixture, "next.config.mjs"),
    `export default {
  serverExternalPackages: ["pg", "pg-boss"],
  webpack(config) {
    config.resolve.alias["@/db"] = ${JSON.stringify(join(repoRoot, "packages/db/src"))};
    config.resolve.alias["@"] = ${JSON.stringify(join(repoRoot, "packages/core/src"))};
    return config;
  },
};\n`,
  );
  await writeFile(
    join(fixture, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/auth": [join(repoRoot, "packages/core/src/auth.ts")],
          "@/db/*": [join(repoRoot, "packages/db/src/*")],
          "@/lib/*": [join(repoRoot, "packages/core/src/lib/*")],
        },
      },
    }),
  );
  const retainedRouteDir = join(fixture, "app", "v1", "models");
  await mkdir(retainedRouteDir, { recursive: true });
  await symlink(
    join(webRoot, "src/app/v1/models/route.ts"),
    join(retainedRouteDir, "route.ts"),
  );

  nextOutput = "";
  nextProcess = spawn(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "dev", fixture, "--webpack", "-p", String(nextPort)],
    {
      cwd: fixture,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nextProcess.stdout?.on("data", (chunk) => { nextOutput += String(chunk); });
  nextProcess.stderr?.on("data", (chunk) => { nextOutput += String(chunk); });
  await waitForNext(nextUrl, nextProcess, () => nextOutput);

  const retained = await fetch(`${nextUrl}/v1/models`);
  const retainedBody = await retained.text();
  assert.equal(
    retained.status,
    401,
    `Web handler 回滚失败:\n${retainedBody.slice(-2000)}\n${nextOutput.slice(-4000)}`,
  );
  assert.equal(JSON.parse(retainedBody).error?.code, "auth.missing_key");
  assert.equal(requests.length, proxiedRequestCount);
  console.log("[gateway-proxy-smoke] 代理透传与 Web handler 回滚通过");
} finally {
  if (nextProcess) await stopChild(nextProcess);
  if (upstream.listening) await closeServer(upstream);
  if (fixture) await rm(fixture, { recursive: true, force: true });
}
