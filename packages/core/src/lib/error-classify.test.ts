import { describe, it, expect } from "vitest";
import { classifyError } from "@/lib/error-classify";
import { ErrorCode } from "@/lib/errors";

describe("classifyError - 已知 errorCode 精确匹配", () => {
  it("auth 类错误 → phase=auth, category=auth(点分码)", () => {
    expect(classifyError({ errorCode: ErrorCode.AUTH_MISSING_KEY })).toEqual({
      phase: "auth",
      category: "auth",
    });
    expect(classifyError({ errorCode: ErrorCode.AUTH_INVALID_KEY })).toEqual({
      phase: "auth",
      category: "auth",
    });
    expect(classifyError({ errorCode: ErrorCode.AUTH_KEY_DISABLED })).toEqual({
      phase: "auth",
      category: "auth",
    });
  });

  it("模型不存在/未绑定/不可用 → phase=request, category=invalid_request(短码与点分码同义)", () => {
    expect(classifyError({ errorCode: "model_not_found" })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
    expect(classifyError({ errorCode: ErrorCode.ROUTING_MODEL_NOT_FOUND })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
    expect(classifyError({ errorCode: "model_not_bound" })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
    expect(classifyError({ errorCode: "model_not_available" })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
  });

  it("no_route/routing_error/capability_not_supported → phase=routing, category=service_unavailable", () => {
    expect(classifyError({ errorCode: "no_route" })).toEqual({
      phase: "routing",
      category: "service_unavailable",
    });
    expect(classifyError({ errorCode: "routing_error" })).toEqual({
      phase: "routing",
      category: "service_unavailable",
    });
    expect(classifyError({ errorCode: "capability_not_supported" })).toEqual({
      phase: "routing",
      category: "service_unavailable",
    });
  });

  it("请求校验类 → phase=request, category=invalid_request", () => {
    expect(classifyError({ errorCode: ErrorCode.REQUEST_INVALID_JSON })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
    expect(classifyError({ errorCode: ErrorCode.REQUEST_MISSING_FIELD })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
  });

  it("generation_failed(短码)与 gateway.generation_failed(点分码)→ phase=upstream, category=upstream", () => {
    expect(classifyError({ errorCode: "generation_failed" })).toEqual({
      phase: "upstream",
      category: "upstream",
    });
    expect(classifyError({ errorCode: ErrorCode.GATEWAY_GENERATION_FAILED })).toEqual({
      phase: "upstream",
      category: "upstream",
    });
  });

  it("gateway.timeout → phase=network", () => {
    expect(classifyError({ errorCode: ErrorCode.GATEWAY_TIMEOUT })).toEqual({
      phase: "network",
      category: "upstream",
    });
  });

  it("多模态失败码 → phase=upstream", () => {
    expect(classifyError({ errorCode: ErrorCode.MEDIA_IMAGE_GEN_FAILED })).toEqual({
      phase: "upstream",
      category: "upstream",
    });
    expect(classifyError({ errorCode: ErrorCode.MEDIA_TTS_FAILED })).toEqual({
      phase: "upstream",
      category: "upstream",
    });
  });

  it("all_routes_failed → category=service_unavailable", () => {
    expect(classifyError({ errorCode: ErrorCode.GATEWAY_ALL_ROUTES_FAILED })).toEqual({
      phase: "upstream",
      category: "service_unavailable",
    });
  });
});

describe("classifyError - httpStatus 推断(errorCode 未命中时)", () => {
  it("401/403 → auth", () => {
    expect(classifyError({ httpStatus: 401 })).toEqual({ phase: "auth", category: "auth" });
    expect(classifyError({ httpStatus: 403 })).toEqual({ phase: "auth", category: "auth" });
  });

  it("429 → rate_limit", () => {
    expect(classifyError({ httpStatus: 429 })).toEqual({
      phase: "request",
      category: "rate_limit",
    });
  });

  it("402 → quota", () => {
    expect(classifyError({ httpStatus: 402 })).toEqual({
      phase: "request",
      category: "quota",
    });
  });

  it("4xx(非 401/403/429/402)→ invalid_request", () => {
    expect(classifyError({ httpStatus: 400 })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
    expect(classifyError({ httpStatus: 404 })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
    expect(classifyError({ httpStatus: 422 })).toEqual({
      phase: "request",
      category: "invalid_request",
    });
  });

  it("5xx → upstream", () => {
    expect(classifyError({ httpStatus: 500 })).toEqual({
      phase: "upstream",
      category: "upstream",
    });
    expect(classifyError({ httpStatus: 502 })).toEqual({
      phase: "upstream",
      category: "upstream" });
    expect(classifyError({ httpStatus: 503 })).toEqual({
      phase: "upstream",
      category: "upstream",
    });
  });
});

describe("classifyError - errorMessage 关键字", () => {
  it("超时关键字 → phase=network", () => {
    expect(classifyError({ errorMessage: "Request timed out after 30s" })).toEqual({
      phase: "network",
      category: "upstream",
    });
  });

  it("连接拒绝/重置 → phase=network", () => {
    expect(classifyError({ errorMessage: "connect ECONNREFUSED 127.0.0.1:443" })).toEqual({
      phase: "network",
      category: "upstream",
    });
    expect(classifyError({ errorMessage: "socket hang up" })).toEqual({
      phase: "network",
      category: "upstream",
    });
  });

  it("无 network 关键字时不命中", () => {
    expect(classifyError({ errorMessage: "内部错误" })).toEqual({
      phase: "internal",
      category: "other",
    });
  });
});

describe("classifyError - 优先级与兜底", () => {
  it("errorCode 优先于 httpStatus", () => {
    // generation_failed 映射 upstream,即便 httpStatus 是 400 也不走 invalid_request
    const r = classifyError({ errorCode: "generation_failed", httpStatus: 400 });
    expect(r).toEqual({ phase: "upstream", category: "upstream" });
  });

  it("未知 errorCode + 无 httpStatus + 无关键字 → 兜底 internal/other", () => {
    expect(classifyError({ errorCode: "some_unknown_code" })).toEqual({
      phase: "internal",
      category: "other",
    });
    expect(classifyError({})).toEqual({ phase: "internal", category: "other" });
  });

  it("httpStatus 优先于 errorMessage 关键字", () => {
    // 5xx 走 upstream,即便 message 含 timeout
    const r = classifyError({ httpStatus: 502, errorMessage: "timeout" });
    expect(r.phase).toBe("upstream");
  });
});
