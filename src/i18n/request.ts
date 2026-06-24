import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const locales = ["zh-CN", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

/**
 * next-intl 请求配置 —— 按 cookie 读取用户语言偏好,fallback 到默认。
 *
 * 策略(Cookie + 自动检测):
 *   1. cookie "locale" 存在且有效 → 用它
 *   2. 否则用 defaultLocale(zh-CN)
 *
 * 首次访问的自动检测由 src/middleware.ts 完成(读 Accept-Language 写 locale cookie)。
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value as Locale | undefined;
  const locale: Locale =
    cookieLocale && locales.includes(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    // 注意:messages 在项目根目录(src 的上一级),此处用 ../../messages。
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
