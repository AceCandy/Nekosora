# Auth Guidelines

> Better Auth 配置约定与 Origin 信任模型。

---

## Overview

- **库**: Better Auth,配置在 `src/auth.ts`,通过 `getAuth()` 惰性初始化(因为 `getDb()` 是 async,而 `drizzleAdapter` 期望同步 db)。
- **适配器**: drizzle,provider 固定 `"pg"`,表名沿用 Better Auth 默认(`user`/`session`/`account`/`verification`)。
- **能力**: `emailAndPassword`(autoSignIn) + `admin` 插件(role/banned 等,本项目额外加了 `status` 列)。
- **baseURL**: 不在代码里硬编码,由 `BETTER_AUTH_URL` 环境变量推导;默认可信 origin 也由此推导。

## Trusted Origins

### Scope / Trigger

- Better Auth 在每个敏感写请求(如 sign-in)校验 `Origin` 头;不在可信列表就返回 `Invalid origin` → `403`,**且发生在密码校验之前**。
- 默认可信列表 = 从 `BETTER_AUTH_URL` 推导出的 origin。
- 需要额外放宽的典型场景:
  - 局域网 IP 联调(`http://192.168.x.x:PORT` 而非 `localhost`)。
  - `next dev` 端口被占用顺延(3000 → 3001 → 3002),与 `BETTER_AUTH_URL` 端口不一致。
  - 同一台机用多个 host/端口访问。

### Contracts

- `trustedOrigins` 的 TS 签名:`string[] | ((request?: Request) => Awaitable<(string | null | undefined)[]>) | undefined`。函数形式返回的 origin 会**追加**到默认可信列表,**不覆盖** `BETTER_AUTH_URL` 推导出的值。
- 生产环境保持空数组(`process.env.NODE_ENV === "production" ? [] : pickDevTrustedOrigin`),只信任 `BETTER_AUTH_URL`;**禁止**在生产放宽。
- 非生产环境通过 `pickDevTrustedOrigin(request?)` 放行:本机回环(`localhost`/`127.0.0.1`)与 RFC1918 私有网段(`10/8`、`192.168/16`、`172.16-31/12`)的任意端口。
- 校验逻辑必须基于精确 host 正则(含端口),从 `request.headers.get("origin")` 取值后用 `new URL(origin).host` 解析。

### Security Constraints

- **禁止用通配符 pattern 放宽 origin**(如 `192.168.*`、`http://*:3000`)。Better Auth 的 `matchesOriginPattern` 里 `*` 默认不跨 `/` 但会跨 `.` 与 `:`,因此 `192.168.*` 会匹配攻击者可控的 `192.168.1.205.evil.com`,形成 DNS 绕过。
- 仅覆盖 IPv4 私有网段;IPv6 链路本地(如 `fe80::`)未覆盖,需要时再补。

### Validation & Error Matrix

- 症状「密码正确但 `POST /api/auth/sign-in/email 403`」+ 服务端日志 `Invalid origin: http://192.168.x.x:PORT` → 是 Origin 校验拒绝,**不是密码错**。排查先看日志里的 origin,而不是密码流程。
- `BETTER_AUTH_URL` 与实际访问地址的 host 或 port 任一不一致 → 403。
- 改 `src/auth.ts` 或 `next.config.ts` 后必须重启 dev server,配置不热更新。

### Wrong vs Correct

Wrong —— 通配符 pattern,会被相似域名绕过:

```ts
trustedOrigins: ["192.168.*", "http://*:3000"]
```

Correct —— 非生产用精确正则函数判定,生产用默认:

```ts
trustedOrigins:
  process.env.NODE_ENV === "production" ? [] : pickDevTrustedOrigin,
```

```ts
function pickDevTrustedOrigin(request?: Request): string[] {
  const origin = request?.headers.get("origin");
  if (!origin) return [];
  const host = (() => { try { return new URL(origin).host; } catch { return ""; } })();
  const loopback = /^(localhost|127\.0\.0\.1):\d{1,5}$/;
  const ipv4Private =
    /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{1,5}$/;
  return loopback.test(host) || ipv4Private.test(host) ? [origin] : [];
}
```

## Next.js Dev Cross-Origin（/_next/*）

- 与上面是**两回事**:`next.config.ts` 的 `allowedDevOrigins` 控制 `next dev` 静态资源(`/_next/*`)的跨域告警,**不参与** Better Auth 的 origin 校验,也不会阻塞登录。
- 从局域网 IP 访问 dev 时,把该 IP 加进 `allowedDevOrigins` 消除告警;换机器/换网段时需同步更新。
- 此告警未来 Next 大版本会从 warning 升级为强制配置,提前配好避免踩坑。

## Common Mistakes

- **把 origin 403 当密码错排查** —— 先看服务端日志的 `Invalid origin:` 行,确认访问地址与 `BETTER_AUTH_URL` 的 host/port 差异。
- **用通配符 pattern 放宽 origin** —— DNS 绕过风险,改用精确 host 正则。
- **生产部署忘了设正确的 `BETTER_AUTH_URL`** —— 生产不走 dev 放宽逻辑,必须配置正式域名。
- **改完 auth/next 配置不重启 dev** —— 配置不热更新,改完务必重启。

## Scenario: User Availability And Secure Bootstrap

### 1. Scope / Trigger

- 修改 Better Auth 用户字段、共享 session 边界、API key 鉴权、首管理员 seed 或 Node/worker 启动入口时适用。
- 目标是让 `user.status = 'active'` 成为 Web session 与 API key 的共同授权谓词,并让生产空库只能用显式强凭据创建首管理员。

### 2. Signatures

- `getSession(): Promise<SessionUser | null>`
- `verifyKey(rawKey: string): Promise<{ ctx: CallContext; record: ApiKeyRecord } | null>`
- `resolveSeedAdminCredentials(env: NodeJS.ProcessEnv): { email: string; password: string; name: string }`
- `validateEnv(): EnvInfo`
- Better Auth `user.additionalFields.status`: `{ type: "string", required: true, defaultValue: "active", input: false }`

### 3. Contracts

- `status` 是服务端只读字段;客户端注册或资料输入不得写入。共享 `getSession` 必须传 `query.disableCookieCache=true`,且只接受严格等于 `active` 的权威 DB 结果。缺失、未知、disabled 或读取异常都返回 `null`。
- `verifyKey` 每次只做一次候选读取:按 prefix 查询 enabled key,inner join owner,并约束 `user.status='active'`;命中后才做常量时间 hash 比较。`lastUsedAt` 的 PostgreSQL `UPDATE ... FROM user` 再次约束 key enabled 与 owner active,避免状态在候选读取后变化时写入禁用 key。
- seed 凭据只在确认数据库无用户后解析。生产环境的 `SEED_ADMIN_PASSWORD` 缺失、trim 后为空或等于公开默认值时必须在创建账号前抛错;非生产保留开发默认值。已有用户不受 seed 密码配置影响。
- Next instrumentation 必须先对 Edge runtime return;Node 路径安装 process guard 后动态 import `env.ts` 并校验,再动态 import DB bootstrap。worker 必须在 queue/RAG 等模块加载及 `getQueue()` 前校验。
- instrumentation 的 Node-only 模块继续使用变量路径动态 import;生产构建是 Edge 依赖边界门禁。

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Session user status is `active` | Return mapped `SessionUser` |
| Session status is missing, unknown, or `disabled` | Return `null` |
| Authoritative session read throws | Return `null` |
| API key disabled or owner non-active | No candidate, no `lastUsedAt` write, return `null` |
| Active owner and matching enabled key | Return gateway context; best-effort conditional `lastUsedAt` update |
| Production empty DB with missing/blank/public-default seed password | Throw before auth signup |
| Existing user in production | Skip seed parsing and account creation |
| Edge instrumentation | Return before all Node-only imports |
| Node/worker environment validation fails | Reject before DB/queue business initialization |

### 5. Good / Base / Bad Cases

- Good:管理员禁用用户后,后续 session 权威读取与 API key owner join 都立即拒绝;不需要在各业务路由重复判断。
- Good:已有用户的生产部署即使没有 `SEED_ADMIN_PASSWORD` 仍能启动,因为不会创建首管理员。
- Base:active 用户保持原有 Web/API key 行为;开发空库仍可使用兼容默认 seed 凭据。
- Bad:从 cookie cache 直接授权,或把缺失 `status` 默认成 active。
- Bad:只检查 `api_keys.enabled`,不检查 key owner 状态。
- Bad:在空库判断前解析生产 seed 密码,或在 Edge instrumentation 静态导入 DB/env 初始化链。

### 6. Tests Required

- Auth 配置测试断言 `status` 的 type/required/defaultValue/input 字段。
- Session 单测覆盖 active、disabled、missing、unknown、读取异常,并断言 `disableCookieCache: true`。
- API key 单测覆盖 active owner 成功、disabled owner 拒绝、拒绝路径零更新,以及条件 `UPDATE ... FROM user` 的 enabled/active 谓词。
- Seed 单测覆盖生产 missing/blank/public-default 拒绝、生产强密码和开发默认;bootstrap 回归断言生产已有用户不要求 seed 密码。
- Instrumentation 测试覆盖 Edge no-op、Node guard -> env -> bootstrap 顺序、校验失败阻断;worker 测试覆盖 env -> getQueue 顺序与失败时零资源副作用。
- 必须运行 `pnpm check`、`pnpm test` 与 `pnpm build`;build 用于保护 Edge 动态 import 边界。

### 7. Wrong vs Correct

Wrong:

```ts
const session = await auth.api.getSession({ headers });
const status = session.user.status ?? "active";
```

Correct:

```ts
const session = await auth.api.getSession({
  headers,
  query: { disableCookieCache: true },
});
if (session?.user.status !== "active") return null;
```

## Scenario: Admin Password Reset

### 1. Scope / Trigger

- 修改管理员用户页的密码设置、用户凭据或会话撤销流程时适用。
- 目标是通过 Better Auth 设置密码，并在成功后立即撤销目标用户现有会话；不得直接写 `account.password`。

### 2. Signatures

```ts
resetUserPassword(userId: string, formData: FormData): Promise<
  | { status: "success"; error: null }
  | { status: "error"; error: "invalidPassword" | "passwordMismatch" | "selfResetForbidden" | "resetFailed" | "sessionRevokeFailed" }
>
```

### 3. Contracts

- 先执行 `requireAdmin()`，再校验目标 ID、8–128 位新密码和确认密码；所有校验必须先于 Better Auth 副作用。
- 管理员用户列表入口不得重置当前登录账号。
- 使用同一请求 headers 依次调用 `auth.api.setUserPassword` 和 `auth.api.revokeUserSessions`。
- 只有两步都成功才返回 `success`；密码、Better Auth 原始错误和凭据数据不得进入日志、URL、返回值或客户端持久化。
- 两个 Better Auth 调用不是同一事务。撤销会话失败时不得尝试恢复旧密码，返回 `sessionRevokeFailed` 并允许管理员使用同一密码重试。

### 4. Validation & Error Matrix

| 条件 | 结果 | 副作用 |
| --- | --- | --- |
| 非管理员 | 鉴权异常 | 不调用 Better Auth |
| 当前管理员为目标 | `selfResetForbidden` | 不调用 Better Auth |
| 密码长度非法 | `invalidPassword` | 不调用 Better Auth |
| 两次密码不一致 | `passwordMismatch` | 不调用 Better Auth |
| 设密失败或目标不存在 | `resetFailed` | 不撤销会话 |
| 设密成功、撤销会话失败 | `sessionRevokeFailed` | 新密码已生效，允许重试 |
| 两步成功 | `success` | 新密码生效，旧会话全部撤销 |

### 5. Good / Base / Bad Cases

- Good：管理员为其他用户设置密码，随后撤销该用户全部会话，UI 只在两步成功后显示完整成功。
- Base：输入不合法时在客户端和服务端都返回稳定错误，表单保留输入供修正。
- Bad：直接更新密码哈希，或设密成功后未撤销会话却显示完整成功。

### 6. Tests Required

- 单测覆盖管理员鉴权、自重置、8/128 位边界、确认密码、调用顺序、设密失败和会话撤销失败。
- 浏览器覆盖初始焦点、行内错误、pending 锁定、失败保留输入、关闭回焦和窄屏无横向溢出。
- 真实合法重置会改变账号凭据并撤销会话；仅在明确可处置的测试账号上执行。

### 7. Wrong vs Correct

```ts
// Wrong：绕过 Better Auth，且不会撤销现有会话。
await db.update(account).set({ password: hash });

// Correct：保留 Better Auth 权限与哈希语义，并按顺序撤销会话。
await auth.api.setUserPassword({ body: { userId, newPassword }, headers });
await auth.api.revokeUserSessions({ body: { userId }, headers });
```

Wrong:

```ts
const keys = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, prefix));
```

Correct:

```ts
const keys = await db
  .select({ key: apiKeys })
  .from(apiKeys)
  .innerJoin(user, eq(apiKeys.userId, user.id))
  .where(and(eq(apiKeys.enabled, true), eq(user.status, "active")));
```
