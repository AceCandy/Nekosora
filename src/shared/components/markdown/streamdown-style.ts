import type { CSSProperties } from "react";

/**
 * HTML 内联 style 过滤器。
 *
 * 当前策略:原样透传 AI 输出的 style,仅对 `color` 属性的纯黑/纯白做中性色映射 -> currentColor,
 * 防 AI 输出纯黑/纯白文字在反色背景下不可见(暗色深底黑字、亮色白底白字)。
 * currentColor 继承父级文字色:暗色下为浅银(nebula-silver)、亮色下为深墨(space-ink),明暗都可读。
 * 其他属性(含 background/border)原样保留,避免改写 AI 视觉意图;安全兜底依赖 streamdown 内置的 rehype-harden。
 */

/** 纯黑/纯白的 HEX 写法(含 8 位带 alpha 的全不透明形式)。 */
const PURE_NEUTRAL_HEX_RE = /#(?:000|000000|000000ff|fff|ffffff|ffffffff)\b/gi;
/** 纯黑/纯白的关键字。 */
const PURE_NEUTRAL_KEYWORD_RE = /\b(?:black|white)\b/gi;
const RGB_COLOR_FUNCTION_RE = /rgba?\(\s*([^)]+)\)/gi;
const HSL_COLOR_FUNCTION_RE = /hsla?\(\s*([^)]+)\)/gi;

/** alpha 为 1 或 100%(完全不透明)时视为不透明;缺省 alpha 也算不透明。 */
function isOpaqueAlpha(value: string | undefined): boolean {
  if (!value) return true;
  return /^(?:1(?:\.0+)?|100%)$/u.test(value.trim());
}

/** 拆分 rgb/hsl 函数内的通道与可选 alpha(支持逗号与空格两种语法、`/` 分隔的 alpha)。 */
function splitColorComponents(value: string): { channels: string[]; alpha?: string } {
  const [channelPart, slashAlpha] = value.split(/\s+\/\s+/u, 2);
  if (channelPart.includes(",")) {
    const parts = channelPart.split(",").map((item) => item.trim());
    return { channels: parts.slice(0, 3), alpha: parts[3] ?? slashAlpha };
  }
  return { channels: channelPart.trim().split(/\s+/u), alpha: slashAlpha };
}

/** rgb/rgba 三通道是否全为 0(黑)或全为 255(白),且不透明。 */
function isPureNeutralRGB(value: string): boolean {
  const { channels, alpha } = splitColorComponents(value);
  if (channels.length !== 3 || !isOpaqueAlpha(alpha)) return false;
  return channels.every((item) => item === "0") || channels.every((item) => item === "255");
}

/** hsl/hsla 的 lightness 是否为 0%(黑)或 100%(白),且不透明。 */
function isPureNeutralHSL(value: string): boolean {
  const { channels, alpha } = splitColorComponents(value);
  if (channels.length !== 3 || !isOpaqueAlpha(alpha)) return false;
  return channels[2] === "0%" || channels[2] === "100%";
}

/** 把 color 值中的纯黑/纯白替换为 currentColor;无匹配则原样返回。 */
function normalizePureNeutralColor(value: string): string {
  return value
    .replace(PURE_NEUTRAL_HEX_RE, "currentColor")
    .replace(PURE_NEUTRAL_KEYWORD_RE, "currentColor")
    .replace(RGB_COLOR_FUNCTION_RE, (match, content: string) => (isPureNeutralRGB(content) ? "currentColor" : match))
    .replace(HSL_COLOR_FUNCTION_RE, (match, content: string) => (isPureNeutralHSL(content) ? "currentColor" : match));
}

/**
 * 原样透传 style,仅把 `color` 属性的纯黑/纯白映射为 currentColor。
 * 返回 undefined 表示无 style 可渲染。
 */
export function sanitizeHTMLStyle(style: CSSProperties | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const color = style.color;
  if (typeof color !== "string") return style;
  const normalized = normalizePureNeutralColor(color);
  return normalized === color ? style : { ...style, color: normalized };
}
