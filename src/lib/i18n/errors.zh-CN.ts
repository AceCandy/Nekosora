/**
 * 中文错误文案(zh-CN)—— 默认 locale。
 *
 * 与 errors.en.ts 一一对应。message 应简短、面向开发者/API 使用者。
 */
import type { ErrorCodeValue } from "@/lib/errors";

export const errorsZhCN: Record<ErrorCodeValue, string> = {
  // auth.*
  "auth.missing_key": "缺少 Authorization: Bearer 头",
  "auth.invalid_key": "无效的 API 密钥",
  "auth.key_disabled": "API 密钥已被禁用",

  // routing.*
  "routing.model_not_found": "模型不存在或未启用",
  "routing.model_not_available": "该模型不可用",
  "routing.model_not_bound": "该模型未绑定到当前密钥",
  "routing.no_route": "该模型没有可用路由",
  "routing.capability_not_supported": "该模型不支持请求的能力",

  // request.*
  "request.invalid_json": "请求体不是合法 JSON",
  "request.missing_field": "缺少必填字段",

  // gateway.*
  "gateway.upstream_error": "上游服务返回错误",
  "gateway.generation_failed": "生成失败",
  "gateway.all_routes_failed": "所有路由均调用失败",
  "gateway.timeout": "上游响应超时",

  // media.*
  "media.image_gen_failed": "图像生成失败",
  "media.tts_failed": "语音合成失败",
  "media.stt_failed": "语音转写失败",

  // server.*
  "server.internal": "服务器内部错误",
  "server.service_unavailable": "服务暂不可用",
};
