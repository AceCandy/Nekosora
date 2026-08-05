import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

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

export type PublicAddressResolver = (hostname: string) => Promise<LookupAddress[]>;

const defaultResolver: PublicAddressResolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

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
    throw new Error("SearXNG 地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SearXNG 只允许 HTTP/HTTPS 公网地址");
  }
  if (url.username || url.password) throw new Error("SearXNG 地址不能包含凭据");
  if (url.hash) throw new Error("SearXNG 地址不能包含片段");

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) === 0 && !hostname.includes("."))
  ) {
    throw new Error("SearXNG 必须使用公网主机名或公网 IP");
  }
  return url;
}

export async function resolvePublicHttpUrl(
  input: string | URL,
  resolver: PublicAddressResolver = defaultResolver,
): Promise<{ url: URL; address: LookupAddress }> {
  const url = parsePublicHttpUrl(String(input));
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily } as LookupAddress]
    : await resolver(url.hostname);
  if (addresses.length === 0 || addresses.some((item) => !isPublicIp(item.address))) {
    throw new Error("SearXNG 地址解析到了非公网 IP");
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

/** 连接到已校验 IP，并保留原 Host/SNI；重定向每一跳重新解析校验。 */
export async function requestPublicJson(
  input: string | URL,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
  redirects = 0,
): Promise<PublicJsonResponse> {
  const { url, address } = await resolvePublicHttpUrl(input);
  const requester = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<PublicJsonResponse>((resolve, reject) => {
    const req = requester({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: url.protocol === "https:" ? url.hostname : undefined,
      headers: { ...options.headers, Host: url.host },
      signal: options.signal,
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error("SearXNG 重定向次数过多"));
          return;
        }
        requestPublicJson(new URL(location, url), options, redirects + 1).then(resolve, reject);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) req.destroy(new Error("SearXNG 响应过大"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status, body: text ? JSON.parse(text) : null });
        } catch {
          reject(new Error("SearXNG 返回了无效 JSON"));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}
