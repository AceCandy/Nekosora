/**
 * i18n 解析器 —— 服务端轻量 locale 处理。
 *
 * 职责:
 *   1. 从 Accept-Language 头解析首选 locale(支持 q 值 + 通配)。
 *   2. 查错误文案字典,返回对应 locale 的 message。
 *   3. fallback:locale 无匹配或文案缺失 → 退回 zh-CN(项目默认)。
 *
 * 不依赖 next-intl 的 React 层(网关是纯 API)。
 * UI 文案国际化(I-11)再接入 next-intl。
 */
import type { ErrorCodeValue } from "@/lib/errors";
import { errorsEn } from "./errors.en";
import { errorsZhCN } from "./errors.zh-CN";

/** 支持的 locale 列表(小写)。新增 locale 在此注册。 */
export const SUPPORTED_LOCALES = ["zh-cn", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 项目默认 locale(无 Accept-Language 或无法识别时使用)。 */
export const DEFAULT_LOCALE: SupportedLocale = "zh-cn";

// locale → 错误文案字典。
const ERROR_DICTIONARIES: Record<SupportedLocale, Record<ErrorCodeValue, string>> = {
  "zh-cn": errorsZhCN,
  en: errorsEn,
};

/**
 * 解析 Accept-Language 头,返回首个支持的首选 locale。
 *
 * 处理规则:
 *   - "zh-CN,zh;q=0.9,en;q=0.8" → zh-cn(精确匹配优先)
 *   - "en-US,en;q=0.9" → en(前缀匹配)
 *   - "*" → 默认 locale
 *   - 空/无法解析 → 默认 locale
 *
 * 简化版:不严格按 q 值排序(取首个非 0 的),实际 Accept-Language
 * 顺序已隐含优先级。
 */
export function resolveLocale(acceptLanguage: string | null): SupportedLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  // 按逗号分割,每项格式 "zh-CN;q=0.9" 或 "en"。
  const entries = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((e) => e.tag && e.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    if (tag === "*") return DEFAULT_LOCALE;
    // 精确匹配(已小写)。
    if ((SUPPORTED_LOCALES as readonly string[]).includes(tag)) {
      return tag as SupportedLocale;
    }
    // 前缀匹配(如 "en-US" → "en")。
    const prefix = tag.split("-")[0];
    if (prefix === "zh") return "zh-cn";
    if (prefix === "en") return "en";
  }

  return DEFAULT_LOCALE;
}

/**
 * 查错误文案。locale 字典缺失某 key 时,fallback 到默认 locale。
 */
export function translateError(code: ErrorCodeValue, locale: SupportedLocale): string {
  return ERROR_DICTIONARIES[locale][code] ?? ERROR_DICTIONARIES[DEFAULT_LOCALE][code] ?? code;
}
