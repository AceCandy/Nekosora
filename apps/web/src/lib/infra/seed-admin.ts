const DEFAULT_ADMIN_EMAIL = "admin@nekusora.local";
const DEFAULT_ADMIN_PASSWORD = "change-me-on-first-login";
const DEFAULT_ADMIN_NAME = "Administrator";

/** 解析首管理员凭据；生产环境禁止缺失、空白或公开默认密码。 */
export function resolveSeedAdminCredentials(env: NodeJS.ProcessEnv) {
  const configuredPassword = env.SEED_ADMIN_PASSWORD;
  const normalizedPassword = configuredPassword?.trim();

  if (
    env.NODE_ENV === "production" &&
    (!normalizedPassword || normalizedPassword === DEFAULT_ADMIN_PASSWORD)
  ) {
    throw new Error("生产环境必须显式设置安全的 SEED_ADMIN_PASSWORD。");
  }

  return {
    email: env.SEED_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL,
    password: configuredPassword ?? DEFAULT_ADMIN_PASSWORD,
    name: env.SEED_ADMIN_NAME ?? DEFAULT_ADMIN_NAME,
  };
}
