# Auth Guidelines

> Better Auth 配置约定与 Origin 信任模型。

---

## Overview

- **库**: Better Auth,配置在 `src/auth.ts`,通过 `getAuth()` 惰性初始化(因为 `getDb()` 是 async,而 `drizzleAdapter` 期望同步 db)。
- **适配器**: drizzle,dual-dialect(`isPg ? "pg" : "sqlite"`),表名沿用 Better Auth 默认(`user`/`session`/`account`/`verification`)。
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
