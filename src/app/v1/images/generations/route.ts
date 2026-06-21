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
import type { LogUsageParams } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) {
    return openaiError("缺少 Authorization: Bearer 头", "missing_api_key", 401);
  }
  const verified = await verifyKey(rawKey);
  if (!verified) {
    return openaiError("无效或已禁用的 API 密钥", "invalid_api_key", 401);
  }

  // 2. 解析请求体
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return openaiError("请求体不是合法 JSON", "invalid_request_error", 400);
  }

  const model = body.model as string | undefined;
  const prompt = body.prompt as string | undefined;
  if (!model || !prompt) {
    return openaiError("model 和 prompt 为必填项", "invalid_request_error", 400);
  }

  const n = Number(body.n ?? 1);
  const size = (body.size as ImageGenOptions["size"]) || undefined;
  const responseFormat = (body.response_format as "b64_json" | "url") ?? "b64_json";

  // 3. 调用适配器
  const ctx = verified.ctx;
  const startedAt = Date.now();
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

    // 5. 用量记录(图像生成无 token,按张记录,后续 Billing 处理)
    await safeLogUsage({
      ctx,
      runId: `img_${crypto.randomUUID()}`,
      model,
      providerRef: result.providerRef,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "success",
    });

    return NextResponse.json({
      created: Math.floor(Date.now() / 1000),
      data,
    });
  } catch (err) {
    if (err instanceof RoutingError) {
      return openaiError(err.message, err.code, 400);
    }
    console.error("[/v1/images/generations] 失败:", err);
    await safeLogUsage({
      ctx,
      runId: `img_${crypto.randomUUID()}`,
      model,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "failed",
      errorCode: "generation_failed",
    });
    return openaiError(
      err instanceof Error ? err.message : "图像生成失败",
      "generation_failed",
      502,
    );
  }
}

type ImageGenOptions = {
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
};

function openaiError(message: string, code: string, status: number) {
  return NextResponse.json(
    { error: { message, type: status >= 500 ? "server_error" : "invalid_request_error", code } },
    { status },
  );
}

async function safeLogUsage(params: LogUsageParams): Promise<void> {
  try {
    await logUsage(params);
  } catch {
    /* 用量记录失败不阻断 */
  }
}
