import { describe, it, expect } from "vitest";
import { ErrorCode, ERROR_META, routingCodeToErrorCode, errorResponse } from "@/lib/errors";

describe("ERROR_META 完整性", () => {
  it("每个 ErrorCode 都有对应映射", () => {
    const codes = Object.values(ErrorCode);
    for (const code of codes) {
      expect(ERROR_META[code], `缺少映射: ${code}`).toBeDefined();
    }
  });

  it("每个映射的 status 是合法 HTTP 状态码(4xx/5xx)", () => {
    for (const [code, meta] of Object.entries(ERROR_META)) {
      expect(meta.status, `${code} status 异常`).toBeGreaterThanOrEqual(400);
      expect(meta.status, `${code} status 异常`).toBeLessThan(600);
    }
  });

  it("每个映射都有非空 i18nKey", () => {
    for (const [code, meta] of Object.entries(ERROR_META)) {
      expect(meta.i18nKey, `${code} i18nKey 为空`).toBeTruthy();
    }
  });
});

describe("错误码 → HTTP status 契约", () => {
  it("auth.* → 401", () => {
    expect(ERROR_META[ErrorCode.AUTH_MISSING_KEY].status).toBe(401);
    expect(ERROR_META[ErrorCode.AUTH_INVALID_KEY].status).toBe(401);
    expect(ERROR_META[ErrorCode.AUTH_KEY_DISABLED].status).toBe(401);
  });

  it("request.* → 400", () => {
    expect(ERROR_META[ErrorCode.REQUEST_INVALID_JSON].status).toBe(400);
    expect(ERROR_META[ErrorCode.REQUEST_MISSING_FIELD].status).toBe(400);
    expect(ERROR_META[ErrorCode.REQUEST_UNSUPPORTED_PARAMETER].status).toBe(400);
  });

  it("routing.model_not_found → 404", () => {
    expect(ERROR_META[ErrorCode.ROUTING_MODEL_NOT_FOUND].status).toBe(404);
  });

  it("routing.model_not_bound → 403", () => {
    expect(ERROR_META[ErrorCode.ROUTING_MODEL_NOT_BOUND].status).toBe(403);
  });

  it("routing.no_route → 503", () => {
    expect(ERROR_META[ErrorCode.ROUTING_NO_ROUTE].status).toBe(503);
  });

  it("gateway.timeout → 504", () => {
    expect(ERROR_META[ErrorCode.GATEWAY_TIMEOUT].status).toBe(504);
  });

  it("gateway.upstream_error → 502", () => {
    expect(ERROR_META[ErrorCode.GATEWAY_UPSTREAM_ERROR].status).toBe(502);
  });

  it("media.* → 502", () => {
    expect(ERROR_META[ErrorCode.MEDIA_IMAGE_GEN_FAILED].status).toBe(502);
    expect(ERROR_META[ErrorCode.MEDIA_TTS_FAILED].status).toBe(502);
  });

  it("server.internal → 500", () => {
    expect(ERROR_META[ErrorCode.SERVER_INTERNAL].status).toBe(500);
  });
});

describe("错误码 → OpenAI type 分类", () => {
  it("auth.* → authentication_error", () => {
    expect(ERROR_META[ErrorCode.AUTH_INVALID_KEY].type).toBe("authentication_error");
  });

  it("request.* → invalid_request_error", () => {
    expect(ERROR_META[ErrorCode.REQUEST_MISSING_FIELD].type).toBe("invalid_request_error");
    expect(ERROR_META[ErrorCode.REQUEST_UNSUPPORTED_PARAMETER].type).toBe("invalid_request_error");
  });

  it("routing.model_not_found → not_found_error", () => {
    expect(ERROR_META[ErrorCode.ROUTING_MODEL_NOT_FOUND].type).toBe("not_found_error");
  });

  it("routing.model_not_bound → permission_denied_error", () => {
    expect(ERROR_META[ErrorCode.ROUTING_MODEL_NOT_BOUND].type).toBe("permission_denied_error");
  });

  it("gateway/server 类 → server_error", () => {
    expect(ERROR_META[ErrorCode.GATEWAY_UPSTREAM_ERROR].type).toBe("server_error");
    expect(ERROR_META[ErrorCode.SERVER_INTERNAL].type).toBe("server_error");
  });
});

describe("routingCodeToErrorCode", () => {
  it("model_not_found 短码映射到点分码", () => {
    expect(routingCodeToErrorCode("model_not_found")).toBe(ErrorCode.ROUTING_MODEL_NOT_FOUND);
  });

  it("no_route 短码映射", () => {
    expect(routingCodeToErrorCode("no_route")).toBe(ErrorCode.ROUTING_NO_ROUTE);
  });

  it("capability_not_supported 短码映射", () => {
    expect(routingCodeToErrorCode("capability_not_supported")).toBe(ErrorCode.ROUTING_CAPABILITY_NOT_SUPPORTED);
  });

  it("未知短码 fallback 到 server.internal", () => {
    expect(routingCodeToErrorCode("unknown_code")).toBe(ErrorCode.SERVER_INTERNAL);
    expect(routingCodeToErrorCode("")).toBe(ErrorCode.SERVER_INTERNAL);
  });
});

describe("errorResponse", () => {
  it("返回标准 body 结构(含 code/message/type)", () => {
    const body = errorResponse(ErrorCode.AUTH_INVALID_KEY);
    expect(body.error.code).toBe(ErrorCode.AUTH_INVALID_KEY);
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBeTruthy();
  });

  it("details 透传", () => {
    const body = errorResponse(ErrorCode.REQUEST_MISSING_FIELD, { fields: ["model"] });
    expect(body.error.details).toEqual({ fields: ["model"] });
  });

  it("messageOverride 覆盖默认文案", () => {
    const body = errorResponse(ErrorCode.AUTH_INVALID_KEY, undefined, "自定义文案");
    expect(body.error.message).toBe("自定义文案");
  });

  it("无 details 时 body 不含 details 字段", () => {
    const body = errorResponse(ErrorCode.AUTH_INVALID_KEY);
    expect(body.error).not.toHaveProperty("details");
  });
});
