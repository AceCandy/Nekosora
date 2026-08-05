/**
 * Better Auth 表定义 —— dialect 中立描述(由 schema/pg.ts import 并用 pg-core 具象化)。
 *
 * Better Auth 的 Drizzle 适配器需要这些表;admin 插件在 user 上加 role/banned/banReason/banExpires。
 * 这里用「描述字段」的方式,schema/pg.ts 负责用具体列类型实例化。
 */

/** user 表字段语义(admin 插件 + 自定义 status additionalField)。 */
export const userFields = {
  name: { type: "text" as const, notNull: true },
  email: { type: "text" as const, notNull: true },
  emailVerified: { type: "boolean" as const, notNull: true, default: false },
  image: { type: "text" as const, nullable: true },
  // admin 插件注入:
  role: { type: "text" as const, notNull: true, default: "user" }, // "user" | "admin"
  banned: { type: "boolean" as const, notNull: true, default: false },
  banReason: { type: "text" as const, nullable: true },
  banExpires: { type: "timestamp" as const, nullable: true },
  // 自定义:
  status: { type: "text" as const, notNull: true, default: "active" }, // "active" | "disabled"
} as const;

/** session 表字段。 */
export const sessionFields = {
  expiresAt: { type: "timestamp" as const, notNull: true },
  token: { type: "text" as const, notNull: true },
  createdAt: { type: "timestamp" as const, notNull: true },
  updatedAt: { type: "timestamp" as const, notNull: true },
  ipAddress: { type: "text" as const, nullable: true },
  userAgent: { type: "text" as const, nullable: true },
} as const;

/** account(OAuth/credential 关联)字段。 */
export const accountFields = {
  accountId: { type: "text" as const, notNull: true },
  providerId: { type: "text" as const, notNull: true },
  userId: { type: "text" as const, notNull: true }, // 外键 user.id
  accessToken: { type: "text" as const, nullable: true },
  refreshToken: { type: "text" as const, nullable: true },
  accessTokenExpiresAt: { type: "timestamp" as const, nullable: true },
  refreshTokenExpiresAt: { type: "timestamp" as const, nullable: true },
  scope: { type: "text" as const, nullable: true },
  idToken: { type: "text" as const, nullable: true },
  password: { type: "text" as const, nullable: true }, // credentials provider 哈希
  createdAt: { type: "timestamp" as const, notNull: true },
  updatedAt: { type: "timestamp" as const, notNull: true },
} as const;

/** verification 字段。 */
export const verificationFields = {
  identifier: { type: "text" as const, notNull: true },
  value: { type: "text" as const, notNull: true },
  expiresAt: { type: "timestamp" as const, notNull: true },
  createdAt: { type: "timestamp" as const, nullable: true },
  updatedAt: { type: "timestamp" as const, nullable: true },
} as const;
