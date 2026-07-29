/**
 * 图像生成端点 —— POST /v1/images/generations
 *
 * OpenAI Images API 兼容格式。
 * 鉴权:Authorization: Bearer sk-xxx(复用网关 sk 鉴权)。
 *
 * 响应:
 *   - response_format=b64_json(默认):返回 data 数组,每项含 b64_json
 *   - response_format=url:生成图存 StorageDriver,返回 url(P2-A)
 *
 * 模型需在 capabilities 标 imageGeneration:true,且 protocol=openai-images。
 */
import { type NextRequest, NextResponse } from "next/server";
import { verifyKey, extractBearer } from "@/lib/keys";
import { generateImageViaRoute, RoutingError } from "@/lib/providers/multimodal/image-gen";
import { getStorage } from "@/lib/infra/storage";
import { logUsage } from "@/lib/usage";
import {
  apiErrorLocalized,
  ErrorCode,
  routingCodeToErrorCode,
  ERROR_META,
} from "@/lib/errors";
import { classifyError } from "@/lib/error-classify";
import { redactErrorMessage } from "@/lib/redaction";
import type { CallContext } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 请求路径常量(错误日志 requestPath 用)。 */
const REQUEST_PATH = "/v1/images/generations";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  // 1. 鉴权
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) {
    await logRouteError({ startedAt, code: ErrorCode.AUTH_MISSING_KEY });
    return apiErrorLocalized(ErrorCode.AUTH_MISSING_KEY, req);
  }
  const verified = await verifyKey(rawKey);
  if (!verified) {
    await logRouteError({ startedAt, code: ErrorCode.AUTH_INVALID_KEY });
    return apiErrorLocalized(ErrorCode.AUTH_INVALID_KEY, req);
  }

  // 2. 解析请求体
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await logRouteError({ startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_INVALID_JSON });
    return apiErrorLocalized(ErrorCode.REQUEST_INVALID_JSON, req);
  }

  const model = body.model as string | undefined;
  const prompt = body.prompt as string | undefined;
  if (!model || !prompt) {
    await logRouteError({
      startedAt,
      ctx: verified.ctx,
      code: ErrorCode.REQUEST_MISSING_FIELD,
      model: model || "(unknown)",
    });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["model", "prompt"] });
  }

  const n = Number(body.n ?? 1);
  const size = (body.size as ImageGenOptions["size"]) || undefined;
  const responseFormat = (body.response_format as "b64_json" | "url") ?? "b64_json";

  // 3. 调用适配器
  const ctx = verified.ctx;
  try {
    const result = await generateImageViaRoute(ctx, model, {
      prompt,
      n: Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 1, // 上限 10 张
      size,
      responseFormat,
    });

    // 4. response_format=url 时存到 StorageDriver
    const data: { b64_json?: string; url?: string; revised_prompt?: string }[] = [];
    if (responseFormat === "url") {
      const storage = await getStorage();
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        if (img.base64) {
          const buf = Buffer.from(img.base64, "base64");
          const key = `images/${ctx.userId}/${crypto.randomUUID()}.png`;
          const stored = await storage.put(key, buf, "image/png");
          data.push({ url: stored.url ?? undefined, revised_prompt: img.revisedPrompt });
        }
      }
    } else {
      for (const img of result.images) {
        data.push({ b64_json: img.base64, revised_prompt: img.revisedPrompt });
      }
    }

    return NextResponse.json({
      created: Math.floor(Date.now() / 1000),
      data,
    });
  } catch (err) {
    const safeMessage = redactErrorMessage(err);
    // 路由/能力解析失败由 route 层写入最终 execution 事实。
    if (err instanceof RoutingError) {
      const code = routingCodeToErrorCode(err.code);
      return apiErrorLocalized(code, req);
    }
    console.error("[/v1/images/generations] 失败:", safeMessage);
    const code = ErrorCode.MEDIA_IMAGE_GEN_FAILED;
    return apiErrorLocalized(
      code,
      req,
      err instanceof Error ? { message: safeMessage } : undefined,
    );
  }
}

type ImageGenOptions = {
  size?: "256x256" | "512x512" | "1792x1024" | "1024x1792";
};

/**
 * 记录一条发生在执行引擎之外的 route 层失败请求。
 * 这些错误发生在适配器之外(适配器内部错误由其自身/上层记录),route 必须自己写。
 * ctx 缺失(鉴权失败)时构造空身份,userId 由 logUsage 收敛为 null。
 */
async function logRouteError(opts: {
  startedAt: number;
  ctx?: CallContext;
  model?: string;
  code: string;
  errorMessage?: string;
}): Promise<void> {
  const ctx: CallContext = opts.ctx ?? {
    userId: "",
    apiKeyId: null,
    keyKind: null,
    source: "gateway",
  };
  const httpStatus = ERROR_META[opts.code as keyof typeof ERROR_META]?.status;
  try {
    await logUsage({
      ctx,
      runId: `err_${crypto.randomUUID()}`,
      model: opts.model ?? "(unknown)",
      usage: {},
      latencyMs: Date.now() - opts.startedAt,
      status: "failed",
      errorCode: opts.code,
      errorMessage: opts.errorMessage,
      httpStatus,
      requestPath: REQUEST_PATH,
      errorPhase: classifyError({ errorCode: opts.code, httpStatus }).phase,
      errorType: opts.code,
    });
  } catch {
    /* 日志失败不阻断主流程 */
  }
}
