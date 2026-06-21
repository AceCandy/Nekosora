/**
 * Better Auth 配置 —— email+password credentials + admin 插件 + Drizzle 适配器。
 *
 * schema 由本项目的 src/db/schema/{pg,sqlite}.ts 提供(Better Auth 标准 5 张表)。
 * admin 插件在 user 表加 role/banned/banReason/banExpires;我们额外加了 status 列。
 *
 * 运行 `pnpm auth:generate` 可让 Better Auth CLI 校验 schema 与本配置一致;
 * 但本项目手写了 schema,故直接使用,无需 generate。
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { getDb, isPg } from "@/lib/infra/db";

// db 实例是 async 的(getDb),但 Better Auth 的 drizzleAdapter 期望同步 db。
// 我们在 getDb() 完成后构建 auth 实例;为此提供 getAuth() 惰性初始化。
//
// 注:Better Auth + admin 插件的内部类型推断存在已知冲突(signInSocial 的 user
// 类型在带不带 admin 字段上不一致),返回类型用宽类型规避,运行时不受影响。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthInstance = any;
let _auth: AuthInstance | null = null;

async function buildAuth(): Promise<AuthInstance> {
  const db = await getDb();
  const instance = betterAuth({
    database: drizzleAdapter(db, {
      provider: isPg ? "pg" : "sqlite",
      // 表名与 Better Auth 默认一致(user/session/account/verification),无需传 schema。
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
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
