import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n/request";

/**
 * next-intl middleware —— Cookie + Accept-Language 自动检测策略。
 *
 * 行为:
 *   1. 首次访问无 cookie → 读 Accept-Language,匹配支持的 locale,写入 cookie
 *   2. 后续访问 → 读 cookie(用户手动切换语言时更新 cookie)
 *   3. 都无 → defaultLocale (zh-CN)
 *
 * 不使用路由前缀(URL 不变),适合内网工具/网关类产品。
 */
export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "never", // URL 不带 /en /zh-CN 前缀
  localeDetection: true, // 启用 Accept-Language 自动检测
});

export const config = {
  // 匹配所有路由,但排除 API、静态资源、_next 内部路径。
  matcher: ["/((?!api|v1|_next|_vercel|.*\\..*).*)"],
};
