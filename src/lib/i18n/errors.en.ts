/**
 * 错误文案 i18n 字典 —— 服务端按 Accept-Language 查找。
 *
 * 设计:
 *   - 网关 /v1/* 是 API(无 React),不需要 next-intl 的组件层,
 *     用轻量字典 + locale 解析即可,零新依赖。
 *   - 每个 locale 一份文件,与 errors.ts 的 ErrorCode 一一对应。
 *   - UI 全量国际化(I-11)再引入 next-intl 处理 React 文案。
 *
 * 新增 locale:复制本文件改后缀,翻译 message,在 index.ts 注册。
 */
import type { ErrorCodeValue } from "@/lib/errors";

export const errorsEn: Record<ErrorCodeValue, string> = {
  // auth.*
  "auth.missing_key": "Missing Authorization: Bearer header",
  "auth.invalid_key": "Invalid API key",
  "auth.key_disabled": "API key has been disabled",

  // routing.*
  "routing.model_not_found": "Model does not exist or is not enabled",
  "routing.model_not_available": "Model is not available",
  "routing.model_not_bound": "Model is not bound to the current key",
  "routing.no_route": "No available route for this model",
  "routing.capability_not_supported": "Model does not support the requested capability",

  // request.*
  "request.invalid_json": "Request body is not valid JSON",
  "request.missing_field": "Missing required field",

  // gateway.*
  "gateway.upstream_error": "Upstream service returned an error",
  "gateway.generation_failed": "Generation failed",
  "gateway.all_routes_failed": "All routes failed",
  "gateway.timeout": "Upstream response timed out",

  // media.*
  "media.image_gen_failed": "Image generation failed",
  "media.tts_failed": "Text-to-speech failed",
  "media.stt_failed": "Speech-to-text failed",

  // server.*
  "server.internal": "Internal server error",
  "server.service_unavailable": "Service temporarily unavailable",
};
