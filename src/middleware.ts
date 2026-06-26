import { NextResponse, type NextRequest } from "next/server";
import { getCookieCache } from "better-auth/cookies";
import { locales, defaultLocale, type Locale } from "./i18n/request";

/**
 * 中间件:i18n Cookie 策略 + /admin 软早筛。
 *
 * 为什么不用 next-intl 的 createMiddleware?
 *   next-intl 在 `localePrefix: "never"` 下会做隐式路由重写,
 *   它期望 app 下存在 `[locale]` 动态段;本项目用扁平路由(无 [locale] 段),
 *   重写后匹配不到目标路由 → SSR 落到默认 not-found → 首页 "This page could not be found."。
 *   因此这里改用自定义中间件:只负责"首次访问时按 Accept-Language 写入 locale cookie",
 *   渲染阶段的 locale 解析交给 src/i18n/request.ts(读 cookie)。
 *
 * /admin 早筛(纵深防御,非最终权限判定):
 *   页面级守卫依赖每个 layout 都记得调 requireAdmin();新增页面若遗漏即为越权。
 *   此处借助 Better Auth 的 cookieCache(session_data,base64url+HMAC 签名,
 *   含 user.role)在边缘做一道早筛:明显非 admin 直接挡回首页,免 DB 查询。
 *   最终权威仍由 src/lib/session.ts 的 requireAdmin() 在 server 端兜底,
 *   且早筛无法判定时(无缓存 cookie)一律放行,交由后端判定,避免误拒。
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  // /admin 早筛:cookieCache 可能滞后最多 5 分钟(auth.ts 的 maxAge),且返回 null
  // 仅表示"边缘无法判定",不能当作"非 admin"的结论,故 null 时放行交后端兜底。
  if (request.nextUrl.pathname.startsWith("/admin")) {
    const secret = process.env.BETTER_AUTH_SECRET;
    const cached =
      secret && (await getCookieCache(request, { secret }).catch(() => null));
    if (cached && cached.user?.role !== "admin") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  const existing = request.cookies.get("locale")?.value as Locale | undefined;

  // 已有有效 cookie → 放行,不做任何重写。
  if (existing && locales.includes(existing)) {
    const res = NextResponse.next();
    // 注入 pathname,供 server layout(headers().get("x-pathname"))按段分流。
    res.headers.set("x-pathname", request.nextUrl.pathname);
    return res;
  }

  // 首次访问:按 Accept-Language 选 locale。
  const accept = request.headers.get("accept-language") ?? "";
  const picked =
    locales.find((l) =>
      accept
        .split(",")
        .some((part) => {
          const tag = part.trim().split(";")[0].toLowerCase();
          // zh-CN 精确匹配,zh/en 等前缀兜底。
          return tag === l.toLowerCase() || tag.startsWith(l.toLowerCase().split("-")[0]);
        }),
    ) ?? defaultLocale;

  const res = NextResponse.next();
  // 注入 pathname,供 server layout(headers().get("x-pathname"))按段分流。
  res.headers.set("x-pathname", request.nextUrl.pathname);
  res.cookies.set("locale", picked, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 年,与 setLocale 保持一致
    sameSite: "lax",
    httpOnly: false,
  });
  return res;
}

export const config = {
  // 匹配所有路由,但排除 API、网关、静态资源、_next 内部路径。
  // 与原 next-intl middleware 的 matcher 保持一致。
  matcher: ["/((?!api|v1|_next|_vercel|.*\\..*).*)"],
};
