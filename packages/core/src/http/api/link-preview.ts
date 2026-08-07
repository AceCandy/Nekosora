import { z } from "zod";
import { apiError, ErrorCode } from "@/lib/errors";
import {
  fetchLinkMetadata,
  fetchLinkPreviewImage,
  probeLink,
} from "@/lib/link-preview";
import { getSessionFromHeaders } from "@/lib/session-request";
import { PublicHttpError } from "@/lib/web-search/public-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  mode: z.enum(["probe", "metadata", "image"]),
  url: z.url().max(4096),
});

export async function GET(req: Request) {
  const user = await getSessionFromHeaders(req.headers);
  if (!user) return apiError(ErrorCode.AUTH_MISSING_KEY, undefined, "未登录");

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return apiError(ErrorCode.REQUEST_INVALID_JSON, undefined, "链接预览参数无效");
  }

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(6000)]);
  try {
    if (parsed.data.mode === "image") {
      const image = await fetchLinkPreviewImage(parsed.data.url, signal);
      return new Response(new Uint8Array(image.body), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": image.contentType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const preview = parsed.data.mode === "probe"
      ? await probeLink(parsed.data.url, signal)
      : await fetchLinkMetadata(parsed.data.url, signal);
    return Response.json(preview, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (signal.aborted) {
      return apiError(ErrorCode.GATEWAY_TIMEOUT, undefined, "链接预览请求超时");
    }
    if (error instanceof PublicHttpError) {
      if (error.code === "response_too_large") {
        return apiError(ErrorCode.REQUEST_PAYLOAD_TOO_LARGE, undefined, "链接预览响应过大");
      }
      if (error.code === "invalid_url" || error.code === "blocked_url") {
        return apiError(ErrorCode.REQUEST_INVALID_JSON, undefined, "链接不可预览");
      }
    }
    return apiError(ErrorCode.GATEWAY_UPSTREAM_ERROR, undefined, "暂时无法获取链接预览");
  }
}
