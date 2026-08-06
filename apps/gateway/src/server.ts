import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { GATEWAY_ROUTES, type GatewayHandlerName } from "@nekusora/contracts/routes";
import {
  apiErrorLocalized,
  ErrorCode,
  MAX_TRANSCRIPTION_BODY_BYTES,
  MAX_TRANSCRIPTION_FILE_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
} from "@nekusora/core/http";
import { getStorage, resolveStorageKind } from "@nekusora/core/storage";
import { closeDb, getDb } from "@nekusora/db";
import { closeQueue, queueAvailable } from "@nekusora/queue";
import { gatewayHandlers, type GatewayHandler } from "./handlers";

export interface BuildServerOptions {
  handlers?: Partial<Record<GatewayHandlerName, GatewayHandler>>;
  closeResources?: () => Promise<void>;
}

type ReadinessCheck = string | { available: boolean } | "error";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkReadiness() {
  return Promise.all([
    withTimeout((async (): Promise<ReadinessCheck> => {
      try {
        const db = await getDb();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).execute("select 1");
        return "ok";
      } catch {
        return "error";
      }
    })(), 2_000),
    withTimeout((async (): Promise<ReadinessCheck> => {
      try {
        const expected = resolveStorageKind();
        const actual = (await getStorage()).kind;
        return expected && actual !== expected ? "error" : actual;
      } catch {
        return "error";
      }
    })(), 2_000),
    withTimeout((async (): Promise<ReadinessCheck> => {
      try {
        return { available: await queueAvailable() };
      } catch {
        return "error";
      }
    })(), 2_000),
  ]);
}

function copyHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}

async function toFetchRequest(request: FastifyRequest, signal: AbortSignal): Promise<Request> {
  const headers = copyHeaders(request);
  const host = headers.get("host") ?? "localhost";
  const url = `${request.protocol}://${host}${request.raw.url ?? request.url}`;
  let body: BodyInit | undefined;

  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.isMultipart()) {
      body = await request.formData();
      headers.delete("content-type");
      headers.delete("content-length");
    } else if (request.body !== undefined && request.body !== null) {
      body = Buffer.isBuffer(request.body)
        ? new Uint8Array(request.body)
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body);
    }
  }

  return new Request(url, {
    method: request.method,
    headers,
    body,
    signal,
  });
}

function sendFetchResponse(reply: FastifyReply, response: Response): FastifyReply {
  reply.code(response.status);
  for (const [name, value] of response.headers) reply.header(name, value);

  if (!response.body) {
    return reply.send();
  }

  return reply.send(Readable.fromWeb(response.body as never));
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: MAX_TRANSCRIPTION_BODY_BYTES,
  });
  const handlers = { ...gatewayHandlers, ...options.handlers };

  server.removeContentTypeParser("application/json");
  server.addContentTypeParser(
    /^application\/(?:[\w.+-]+\+)?json$/i,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  server.register(multipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: MAX_TRANSCRIPTION_FILE_BYTES,
      files: 1,
      fields: 16,
      parts: 17,
    },
  });

  server.setErrorHandler(async (error, request, reply) => {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
    const code = statusCode === 413
      ? ErrorCode.REQUEST_PAYLOAD_TOO_LARGE
      : typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
        ? ErrorCode.REQUEST_INVALID_JSON
      : ErrorCode.SERVER_INTERNAL;
    const maxFileBytes = code === ErrorCode.REQUEST_PAYLOAD_TOO_LARGE
      ? request.routeOptions.url === "/api/upload"
        ? MAX_UPLOAD_FILE_BYTES
        : request.routeOptions.url === "/v1/audio/transcriptions"
          ? MAX_TRANSCRIPTION_FILE_BYTES
          : undefined
      : undefined;
    const response = await apiErrorLocalized(
      code,
      new Request("http://gateway.local", { headers: copyHeaders(request) }),
      maxFileBytes === undefined ? undefined : { maxFileBytes },
    );
    return sendFetchResponse(reply, response);
  });

  server.get("/healthz", async () => ({
    status: "ok",
    uptime: Math.round(process.uptime()),
    ts: Date.now(),
  }));
  server.get("/healthz/ready", async (_request, reply) => {
    const [db, storage, queue] = await checkReadiness();
    const ready = db === "ok"
      && storage !== "error"
      && storage !== "timeout"
      && typeof queue === "object"
      && queue.available;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "unready",
      checks: { db, storage, queue },
      ts: Date.now(),
    });
  });

  for (const route of GATEWAY_ROUTES) {
    const multipartLimits = route.path === "/api/upload"
      ? { bodyLimit: MAX_UPLOAD_BODY_BYTES, fileSize: MAX_UPLOAD_FILE_BYTES }
      : route.path === "/v1/audio/transcriptions"
        ? {
            bodyLimit: MAX_TRANSCRIPTION_BODY_BYTES,
            fileSize: MAX_TRANSCRIPTION_FILE_BYTES,
          }
        : undefined;
    server.route({
      method: route.method,
      url: route.path,
      ...(multipartLimits
        ? {
            bodyLimit: multipartLimits.bodyLimit,
            config: {
              multipartOptions: { limits: { fileSize: multipartLimits.fileSize } },
            },
          }
        : {}),
      handler: async (request, reply) => {
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        request.raw.once("aborted", abort);
        reply.raw.once("close", () => {
          if (!reply.raw.writableEnded) abort();
        });

        const fetchRequest = await toFetchRequest(request, abortController.signal);
        const response = await handlers[route.handler](
          fetchRequest,
          (request.params ?? {}) as Record<string, string>,
        );
        return sendFetchResponse(reply, response);
      },
    });
  }

  server.addHook("onClose", async () => {
    if (options.closeResources) {
      await options.closeResources();
      return;
    }
    await Promise.allSettled([closeQueue(), closeDb()]);
  });

  return server;
}
