/**
 * OpenAI / Anthropic 兼容端点 —— GET /v1/models
 * 返回该 key 可用的模型列表(网关 owner-only:主 key 列调用者自己的全部 enabled 模型;子 key 仅列绑定的)。
 */
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { apiErrorLocalized, ErrorCode } from "@/lib/errors";
import { resolveLocale, translateError } from "@/lib/i18n";
import type { CallContext } from "@/lib/providers/types";
import { authenticateGatewayRequest } from "@/lib/protocols/auth";
import { protocolErrorResponse } from "@/lib/protocols/encoders";
import {
  GatewayRequestError,
  UnsupportedParameterError,
} from "@/lib/protocols/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UNKNOWN_CREATED_AT = new Date(0).toISOString();

interface ListedModel {
  id: string;
  displayName: string;
}

interface AnthropicPagination {
  limit: number;
  afterId: string | null;
  beforeId: string | null;
}

export async function GET(req: Request) {
  const anthropic = req.headers.has("x-api-key") || req.headers.has("anthropic-version");
  let ctx: CallContext;
  let pagination: AnthropicPagination | null = null;
  try {
    ctx = await authenticateGatewayRequest(req, anthropic ? "anthropic" : "openai-chat");
    if (anthropic) pagination = parseAnthropicPagination(req.url);
  } catch (error) {
    if (!(error instanceof GatewayRequestError)) throw error;
    return modelListError(req, anthropic, error);
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const models: ListedModel[] = [];
  const seen = new Set<string>();
  const add = (id: string, displayName?: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    models.push({ id, displayName: displayName?.trim() || id });
  };
  const selection = { id: s.models.name, displayName: s.models.displayName };

  // 网关语义 owner-only:public 对网关不可见,只列调用者自己创建的模型。
  if (ctx.keyKind === "sub") {
    // 子 key:仅返回绑定的模型(收敛后 keyModelBindings 单 modelId)。
    const bindings = await db
      .select()
      .from(s.keyModelBindings)
      .where(eq(s.keyModelBindings.keyId, ctx.apiKeyId));

    for (const b of bindings) {
      if (!b.modelId) continue;
      const [m] = await db
        .select(selection)
        .from(s.models)
        .where(and(
          eq(s.models.id, b.modelId),
          eq(s.models.ownerUserId, ctx.userId),
          eq(s.models.enabled, true),
        ))
        .limit(1);
      if (m) add(m.id, m.displayName);
    }
  } else {
    // 主 key:owner 自己的全部 enabled 模型(public + private)。
    const myModels = await db
      .select(selection)
      .from(s.models)
      .where(and(eq(s.models.ownerUserId, ctx.userId), eq(s.models.enabled, true)));
    for (const m of myModels) add(m.id, m.displayName);
  }

  if (!anthropic || !pagination) {
    const created = Math.floor(Date.now() / 1000);
    return Response.json({
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created,
        owned_by: "nekusora",
      })),
    });
  }

  try {
    const { page, hasMore } = paginateAnthropicModels(models, pagination);
    return Response.json({
      data: page.map((model) => ({
        id: model.id,
        created_at: UNKNOWN_CREATED_AT,
        display_name: model.displayName,
        type: "model",
      })),
      first_id: page[0]?.id ?? null,
      has_more: hasMore,
      last_id: page.at(-1)?.id ?? null,
    });
  } catch (error) {
    if (!(error instanceof GatewayRequestError)) throw error;
    return modelListError(req, true, error);
  }
}

function parseAnthropicPagination(url: string): AnthropicPagination {
  const params = new URL(url).searchParams;
  const allowed = new Set(["after_id", "before_id", "limit"]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new UnsupportedParameterError(key);
    if (params.getAll(key).length > 1) throw invalidParameter(key, "Expected a single value.");
  }

  const afterId = params.get("after_id");
  const beforeId = params.get("before_id");
  if (afterId !== null && !afterId) throw invalidParameter("after_id", "Expected a model ID.");
  if (beforeId !== null && !beforeId) throw invalidParameter("before_id", "Expected a model ID.");
  if (afterId && beforeId) {
    throw invalidParameter("after_id", "Cannot be combined with 'before_id'.");
  }

  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 1000)) {
    throw invalidParameter("limit", "Expected an integer between 1 and 1000.");
  }
  return { limit, afterId, beforeId };
}

function paginateAnthropicModels(
  input: ListedModel[],
  pagination: AnthropicPagination,
): { page: ListedModel[]; hasMore: boolean } {
  const models = [...input].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (pagination.afterId) {
    const cursor = models.findIndex((model) => model.id === pagination.afterId);
    if (cursor < 0) throw invalidParameter("after_id", "Unknown model ID.");
    const end = Math.min(models.length, cursor + 1 + pagination.limit);
    return { page: models.slice(cursor + 1, end), hasMore: end < models.length };
  }
  if (pagination.beforeId) {
    const cursor = models.findIndex((model) => model.id === pagination.beforeId);
    if (cursor < 0) throw invalidParameter("before_id", "Unknown model ID.");
    const start = Math.max(0, cursor - pagination.limit);
    return { page: models.slice(start, cursor), hasMore: start > 0 };
  }
  const end = Math.min(models.length, pagination.limit);
  return { page: models.slice(0, end), hasMore: end < models.length };
}

function invalidParameter(parameter: string, expectation: string): GatewayRequestError {
  return new GatewayRequestError(
    ErrorCode.REQUEST_INVALID_JSON,
    `Invalid parameter: '${parameter}'. ${expectation}`,
    { parameter },
  );
}

async function modelListError(
  request: Request,
  anthropic: boolean,
  error: GatewayRequestError,
): Promise<Response> {
  if (!anthropic) return apiErrorLocalized(error.code, request, error.details);
  const message = error.code.startsWith("auth.")
    ? translateError(error.code, resolveLocale(request.headers.get("accept-language")))
    : error.message;
  return protocolErrorResponse("anthropic", error.code, message, error.details);
}
