/**
 * Better Auth 配置 —— email+password credentials + admin 插件 + Drizzle 适配器。
 *
 * schema 由本项目的 src/db/schema/pg.ts 提供(Better Auth 标准 5 张表)。
 * admin 插件在 user 表加 role/banned/banReason/banExpires;我们额外加了 status 列。
 *
 * 运行 `pnpm auth:generate` 可让 Better Auth CLI 校验 schema 与本配置一致;
 * 但本项目手写了 schema,故直接使用,无需 generate。
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { getDb } from "@nekusora/db";

// db 实例是 async 的(getDb),但 Better Auth 的 drizzleAdapter 期望同步 db。
// 我们在 getDb() 完成后构建 auth 实例;为此提供 getAuth() 惰性初始化。
//
// 注:Better Auth + admin 插件的内部类型推断存在已知冲突(signInSocial 的 user
// 类型在带不带 admin 字段上不一致),返回类型用宽类型规避,运行时不受影响。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthInstance = any;
let _auth: AuthInstance | null = null;

/**
 * 开发期局域网联调用的可信 Origin 判定。
 *
 * Better Auth 默认只信任由 BETTER_AUTH_URL 推导出的 origin;但本机联调时 next dev
 * 端口会顺延(3000→3001→3002),且常需用局域网 IP 而非 localhost 访问,二者都会
 * 触发 "Invalid origin" → 403,且发生在密码校验之前。这里在非生产环境下额外放行
 * 本机回环与 RFC1918 私有网段的任意端口;生产环境不放宽,仍受 BETTER_AUTH_URL 约束。
 *
 * 用精确 host 正则而非通配符 pattern,避免被相似域名绕过(如 192.168.1.205.evil.com)。
 */
function pickDevTrustedOrigin(request?: Request): string[] {
  const origin = request?.headers.get("origin");
  if (!origin) return [];
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return [];
  }
  const loopback = /^(localhost|127\.0\.0\.1):\d{1,5}$/;
  const ipv4Private =
    /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{1,5}$/;
  return loopback.test(host) || ipv4Private.test(host) ? [origin] : [];
}

async function buildAuth(): Promise<AuthInstance> {
  const db = await getDb();
  const instance = betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      // 表名与 Better Auth 默认一致(user/session/account/verification),无需传 schema。
    }),
    // 非生产环境追加可信 origin(本机回环 + 私有网段任意端口);生产保持默认(由 BETTER_AUTH_URL 推导)。
    trustedOrigins:
      process.env.NODE_ENV === "production" ? [] : pickDevTrustedOrigin,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        status: {
          type: "string",
          required: true,
          defaultValue: "active",
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 天(秒)
      updateAge: 60 * 60 * 24, // 每天刷新一次过期
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 中间件可从 cookie 读会话,免 DB 查询
      },
    },
    plugins: [
      admin({
        defaultRole: "user",
        adminRole: "admin",
      }),
    ],
  });
  return instance as AuthInstance;
}

/** 获取已初始化的 auth 实例(惰性)。 */
export async function getAuth(): Promise<AuthInstance> {
  if (!_auth) _auth = await buildAuth();
  return _auth;
}
