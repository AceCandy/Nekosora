import { describe, expect, it } from "vitest";
import {
  isSensitiveFieldName,
  redactErrorMessage,
  redactSensitiveText,
} from "@/lib/redaction";

describe("isSensitiveFieldName", () => {
  it("统一识别常见凭据字段且不误伤相似业务字段", () => {
    for (const name of [
      "key",
      "apiKey",
      "x-api-key",
      "refresh_token",
      "clientSecret",
      "Authorization",
    ]) {
      expect(isSensitiveFieldName(name)).toBe(true);
    }
    expect(isSensitiveFieldName("tokenCount")).toBe(false);
    expect(isSensitiveFieldName("monkey")).toBe(false);
  });
});

describe("redactSensitiveText", () => {
  it("按字面值最长优先替换精确 secret,并忽略空串", () => {
    const secret = "sk-a+b?.[x]";

    expect(
      redactSensitiveText(`request failed for ${secret}`, ["", "sk-a", secret]),
    ).toBe("request failed for [REDACTED]");
  });

  it("清理 URL 中的敏感 query 参数并保留其他参数", () => {
    expect(
      redactSensitiveText(
        "fetch failed: https://example.test/models?key=SECRET&limit=10&refreshToken=TOKEN#part",
      ),
    ).toBe(
      "fetch failed: https://example.test/models?key=[REDACTED]&limit=10&refreshToken=[REDACTED]#part",
    );
  });

  it("清理 Authorization、Bearer 与 x-api-key 凭据", () => {
    expect(
      redactSensitiveText(
        "Authorization: Bearer AUTH_SECRET\nx-api-key=HEADER_SECRET\nrequest Bearer TOKEN_SECRET failed",
      ),
    ).toBe(
      "Authorization: Bearer [REDACTED]\nx-api-key=[REDACTED]\nrequest Bearer [REDACTED] failed",
    );
  });

  it("清理 JSON 与键值文本中的敏感字段", () => {
    expect(
      redactSensitiveText(
        '{"apiKey":"SECRET","nested":{"password":"P ASS"},"message":"ok"} auth=\'A B\'',
      ),
    ).toBe(
      '{"apiKey":"[REDACTED]","nested":{"password":"[REDACTED]"},"message":"ok"} auth=\'[REDACTED]\'',
    );
  });

  it("重复清理保持幂等,普通诊断内容不变", () => {
    const ordinary = "fetch failed with HTTP 503: upstream unavailable";
    const redacted = redactSensitiveText("api_key=SECRET; HTTP 401");

    expect(redactSensitiveText(redacted)).toBe(redacted);
    expect(redactSensitiveText(ordinary)).toBe(ordinary);
  });
});

describe("redactErrorMessage", () => {
  it("只返回安全消息,并为 nullish 错误使用调用方 fallback", () => {
    expect(
      redactErrorMessage(
        new Error("fetch failed: https://example.test/models?key=SECRET"),
        ["SECRET"],
        "上游请求失败",
      ),
    ).toBe("fetch failed: [REDACTED]");
    expect(redactErrorMessage(null, [], "上游请求失败")).toBe("上游请求失败");
  });

  it("不让 provider 或 PostgreSQL URL 离开错误边界", () => {
    expect(
      redactErrorMessage(
        new Error("POST https://provider.example/v1 failed via postgresql://user:pass@db/private"),
      ),
    ).toBe("POST [REDACTED] failed via [REDACTED]");
  });
});
