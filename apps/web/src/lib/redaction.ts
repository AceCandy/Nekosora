const REDACTED = "[REDACTED]";
const SENSITIVE_FIELD_SOURCE =
  "(?:authorization|auth|key|api[_-]?key|(?:access|refresh|id)[_-]?token|token|client[_-]?secret|secret[_-]?key|secret|password|passwd|cookie|set-cookie|x-api-key|bearer)";
const SENSITIVE_ASSIGNMENT_FIELD_SOURCE =
  "(?:key|api[_-]?key|(?:access|refresh|id)[_-]?token|token|client[_-]?secret|secret[_-]?key|secret|password|passwd|cookie|set-cookie|x-api-key)";
const SENSITIVE_FIELD_RE = new RegExp(`^${SENSITIVE_FIELD_SOURCE}$`, "i");
const SENSITIVE_QUERY_RE = new RegExp(
  `([?&]${SENSITIVE_FIELD_SOURCE}=)(?!["'])[^&#\\s"']*`,
  "gi",
);
const SENSITIVE_QUOTED_ASSIGNMENT_RE = new RegExp(
  `((?:["']?${SENSITIVE_FIELD_SOURCE}["']?)\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\\\r\\n])*"|'(?:\\\\.|[^'\\\\\\r\\n])*')`,
  "gi",
);
const AUTHORIZATION_RE =
  /(\b(?:authorization|auth|bearer)\b\s*[:=]\s*)(?:(bearer|basic|token)\s+)?[^\s,;"']+/gi;
const BEARER_RE = /(\bbearer\s+)[^\s,;"']+/gi;
const SENSITIVE_ASSIGNMENT_RE = new RegExp(
  `(\\b${SENSITIVE_ASSIGNMENT_FIELD_SOURCE}\\b\\s*[:=]\\s*)[^\\s,;&#"']+`,
  "gi",
);
const INFRASTRUCTURE_URL_RE = /\b(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi;

type Secret = string | null | undefined;

/** 判断对象字段或键值名称是否承载凭据。 */
export function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_RE.test(name);
}

/** 清理错误文本中的调用方已知凭据。 */
export function redactSensitiveText(
  text: string,
  secrets: readonly Secret[] = [],
): string {
  const orderedSecrets = [...new Set(secrets.filter((secret): secret is string => Boolean(secret)))]
    .sort((left, right) => right.length - left.length);

  const safeText = orderedSecrets.reduce(
    (safeText, secret) => safeText.split(secret).join(REDACTED),
    text,
  );

  return safeText
    .replace(
      SENSITIVE_QUOTED_ASSIGNMENT_RE,
      (_match, prefix: string, quotedValue: string) =>
        `${prefix}${quotedValue[0]}${REDACTED}${quotedValue[0]}`,
    )
    .replace(SENSITIVE_QUERY_RE, `$1${REDACTED}`)
    .replace(AUTHORIZATION_RE, (_match, prefix: string, scheme?: string) =>
      `${prefix}${scheme ? `${scheme} ` : ""}${REDACTED}`,
    )
    .replace(SENSITIVE_ASSIGNMENT_RE, `$1${REDACTED}`)
    .replace(BEARER_RE, `$1${REDACTED}`);
}

/** 从未知异常提取脱敏消息,不向下游传递原始 Error/cause/stack。 */
export function redactErrorMessage(
  error: unknown,
  secrets: readonly Secret[] = [],
  fallback = "Unknown error",
): string {
  const message = error instanceof Error
    ? error.message
    : error == null
      ? fallback
      : String(error);
  return redactSensitiveText(message || fallback, secrets)
    .replace(INFRASTRUCTURE_URL_RE, REDACTED);
}
