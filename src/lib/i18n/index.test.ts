import { describe, it, expect } from "vitest";
import { resolveLocale, translateError, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/i18n";
import { ErrorCode, type ErrorCodeValue } from "@/lib/errors";

describe("resolveLocale", () => {
  it("空值/null → 默认 locale(zh-cn)", () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("通配 * → 默认 locale", () => {
    expect(resolveLocale("*")).toBe(DEFAULT_LOCALE);
  });

  it("精确匹配 zh-CN(大小写不敏感) → zh-cn", () => {
    expect(resolveLocale("zh-CN")).toBe("zh-cn");
    expect(resolveLocale("ZH-cn")).toBe("zh-cn");
  });

  it("精确匹配 en → en", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("前缀匹配:zh-CN,zh;q=0.9 → zh-cn", () => {
    expect(resolveLocale("zh-CN,zh;q=0.9")).toBe("zh-cn");
  });

  it("前缀匹配:en-US,en;q=0.9 → en", () => {
    expect(resolveLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("多语言按顺序取首个支持的(zh 优先于 en)", () => {
    expect(resolveLocale("fr-FR,fr;q=0.9,en;q=0.8")).toBe("en");
  });

  it("无法识别的语言 → 默认 locale", () => {
    expect(resolveLocale("ja-JP,ja;q=0.9")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("xx-YY")).toBe(DEFAULT_LOCALE);
  });
});

describe("translateError", () => {
  it("zh-cn 字典覆盖所有错误码", () => {
    const codes = Object.values(ErrorCode) as ErrorCodeValue[];
    for (const code of codes) {
      const msg = translateError(code, "zh-cn");
      expect(msg, `zh-cn 缺失: ${code}`).toBeTruthy();
      // 缺失时 fallback 返回 code 本身,不应出现这种情况
      expect(msg).not.toBe(code);
    }
  });

  it("en 字典覆盖所有错误码", () => {
    const codes = Object.values(ErrorCode) as ErrorCodeValue[];
    for (const code of codes) {
      const msg = translateError(code, "en");
      expect(msg, `en 缺失: ${code}`).toBeTruthy();
      expect(msg).not.toBe(code);
    }
  });

  it("zh-cn 与 en 对同一 code 返回不同文案", () => {
    const zh = translateError(ErrorCode.AUTH_INVALID_KEY, "zh-cn");
    const en = translateError(ErrorCode.AUTH_INVALID_KEY, "en");
    expect(zh).not.toBe(en);
  });
});

describe("常量", () => {
  it("DEFAULT_LOCALE 是 zh-cn", () => {
    expect(DEFAULT_LOCALE).toBe("zh-cn");
  });

  it("SUPPORTED_LOCALES 包含 zh-cn 和 en", () => {
    expect(SUPPORTED_LOCALES).toContain("zh-cn");
    expect(SUPPORTED_LOCALES).toContain("en");
  });
});
