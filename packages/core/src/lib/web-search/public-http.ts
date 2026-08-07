import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOH_RESPONSE_BYTES = 64 * 1024;
const DOH_HOSTNAME = "cloudflare-dns.com";
const DOH_ADDRESS: LookupAddress = { address: "1.1.1.1", family: 4 };

export type PublicHttpErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "redirect_limit"
  | "response_too_large";

export class PublicHttpError extends Error {
  constructor(
    public readonly code: PublicHttpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublicHttpError";
  }
}

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blockedV6.addSubnet(network, prefix, "ipv6");

const fakeIpV4 = new BlockList();
fakeIpV4.addSubnet("198.18.0.0", 15, "ipv4");

export type PublicAddressResolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<LookupAddress[]>;

const defaultResolver: PublicAddressResolver = async (hostname, signal) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length > 0
    && addresses.every((item) => item.family === 4 && fakeIpV4.check(item.address, "ipv4"))
  ) {
    return resolveFakeIpHostname(hostname, signal);
  }
  return addresses;
};

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

function parsePublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicHttpError("invalid_url", "SearXNG 地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicHttpError("invalid_url", "SearXNG 只允许 HTTP/HTTPS 公网地址");
  }
  if (url.username || url.password) {
    throw new PublicHttpError("invalid_url", "SearXNG 地址不能包含凭据");
  }
  if (url.hash) throw new PublicHttpError("invalid_url", "SearXNG 地址不能包含片段");

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) === 0 && !hostname.includes("."))
  ) {
    throw new PublicHttpError("blocked_url", "SearXNG 必须使用公网主机名或公网 IP");
  }
  return url;
}

export async function resolvePublicHttpUrl(
  input: string | URL,
  resolver: PublicAddressResolver = defaultResolver,
  signal?: AbortSignal,
): Promise<{ url: URL; address: LookupAddress }> {
  const url = parsePublicHttpUrl(String(input));
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily } as LookupAddress]
    : await withAbortSignal(resolver(url.hostname, signal), signal);
  if (addresses.length === 0 || addresses.some((item) => !isPublicIp(item.address))) {
    throw new PublicHttpError("blocked_url", "SearXNG 地址解析到了非公网 IP");
  }
  return { url, address: addresses[0] };
}

export async function assertPublicHttpUrl(input: string): Promise<void> {
  await resolvePublicHttpUrl(input);
}

interface PublicJsonResponse {
  status: number;
  body: unknown;
}

export interface PublicHttpResponse {
  status: number;
  url: URL;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface PublicHttpRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
  maxResponseBytes?: number;
  readBody?: boolean;
  truncateBody?: boolean;
  resolver?: PublicAddressResolver;
}

/** 读取受限公网响应；连接固定到已校验 IP，且每次重定向重新校验目标。 */
export async function requestPublicResponse(
  input: string | URL,
  options: PublicHttpRequestOptions = {},
  redirects = 0,
): Promise<PublicHttpResponse> {
  const { url, address } = await resolvePublicHttpUrl(
    input,
    options.resolver ?? defaultResolver,
    options.signal,
  );
  const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const readBody = options.readBody ?? true;

  return new Promise<PublicHttpResponse>((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: PublicHttpResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = requester({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? "GET",
      servername: url.protocol === "https:" ? url.hostname : undefined,
      headers: { ...options.headers, Host: url.host },
      signal: options.signal,
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          settleReject(new PublicHttpError("redirect_limit", "SearXNG 重定向次数过多"));
          return;
        }
        requestPublicResponse(new URL(location, url), options, redirects + 1)
          .then(settleResolve, settleReject);
        return;
      }

      if (!readBody || options.method === "HEAD") {
        res.destroy();
        settleResolve({ status, url, headers: res.headers, body: Buffer.alloc(0) });
        return;
      }

      const contentLength = Number(res.headers["content-length"]);
      if (
        !options.truncateBody
        && Number.isFinite(contentLength)
        && contentLength > maxResponseBytes
      ) {
        const error = new PublicHttpError("response_too_large", "SearXNG 响应过大");
        res.destroy();
        req.destroy(error);
        settleReject(error);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          if (options.truncateBody) {
            const remaining = maxResponseBytes - (size - chunk.length);
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            res.destroy();
            settleResolve({ status, url, headers: res.headers, body: Buffer.concat(chunks) });
            return;
          }
          const error = new PublicHttpError("response_too_large", "SearXNG 响应过大");
          res.destroy();
          req.destroy(error);
          settleReject(error);
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        settleResolve({ status, url, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on("error", settleReject);
    });
    req.on("error", settleReject);
    req.end();
  });
}

async function queryDoh(hostname: string, type: "A" | "AAAA", signal?: AbortSignal) {
  const url = new URL(`https://${DOH_HOSTNAME}/dns-query`);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);
  const response = await requestPublicResponse(url, {
    signal,
    maxResponseBytes: DOH_RESPONSE_BYTES,
    headers: { Accept: "application/dns-json" },
    resolver: async (target) => target === DOH_HOSTNAME ? [DOH_ADDRESS] : [],
  });
  if (response.status !== 200) return [];

  const body = JSON.parse(response.body.toString("utf8")) as {
    Status?: unknown;
    Answer?: Array<{ type?: unknown; data?: unknown }>;
  };
  if (body.Status !== 0 || !Array.isArray(body.Answer)) return [];
  const expectedFamily = type === "A" ? 4 : 6;
  const expectedRecordType = type === "A" ? 1 : 28;
  return body.Answer.flatMap((answer): LookupAddress[] => (
    answer.type === expectedRecordType
      && typeof answer.data === "string"
      && isIP(answer.data) === expectedFamily
      ? [{ address: answer.data, family: expectedFamily }]
      : []
  ));
}

async function resolveFakeIpHostname(
  hostname: string,
  signal?: AbortSignal,
): Promise<LookupAddress[]> {
  const ipv4 = await queryDoh(hostname, "A", signal);
  return ipv4.length > 0 ? ipv4 : queryDoh(hostname, "AAAA", signal);
}

/** 连接到已校验 IP，并保留原 Host/SNI；重定向每一跳重新解析校验。 */
export async function requestPublicJson(
  input: string | URL,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<PublicJsonResponse> {
  const response = await requestPublicResponse(input, {
    ...options,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  });
  try {
    const text = response.body.toString("utf8");
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    throw new Error("SearXNG 返回了无效 JSON");
  }
}
