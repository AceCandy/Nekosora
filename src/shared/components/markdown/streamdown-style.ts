/**
 * HTML 内联样式安全过滤器。
 *
 * AI 输出的 markdown 中可能包含原生 HTML 块(如 <div style="...">),
 * 放行 style 属性后需对其值做白名单过滤,避免:
 *   - XSS:url() / expression() / javascript: / @import 等危险值
 *   - 暗色模式塌陷:纯黑 #000 / 纯白 #fff 在暗色背景下不可读,
 *     映射到主题变量 --foreground / --background / --border
 *
 * 仅保留安全的布局与视觉属性(display / flex / color / padding 等)。
 * 逻辑参考 DEEIX-Chat 的 streamdown-style.ts。
 */
import type { CSSProperties } from "react";

/** 允许透传的 CSS 属性白名单(布局 + 视觉类)。 */
const SAFE_STYLE_PROPERTIES: ReadonlySet<string> = new Set([
  "alignContent", "alignItems", "alignSelf",
  "background", "backgroundColor",
  "border", "borderBlock", "borderBlockEnd", "borderBlockStart",
  "borderBottom", "borderBottomWidth",
  "borderColor", "borderInline", "borderInlineEnd", "borderInlineStart",
  "borderLeft", "borderRadius", "borderRight", "borderStyle", "borderTop", "borderWidth",
  "boxShadow", "boxSizing",
  "color", "columnGap",
  "display",
  "flex", "flexBasis", "flexDirection", "flexGrow", "flexShrink", "flexWrap",
  "fontSize", "fontStyle", "fontWeight",
  "gap",
  "gridAutoColumns", "gridAutoFlow", "gridAutoRows",
  "gridColumn", "gridColumnEnd", "gridColumnStart",
  "gridRow", "gridRowEnd", "gridRowStart",
  "gridTemplateColumns", "gridTemplateRows",
  "height",
  "justifyItems", "justifyContent", "justifySelf",
  "lineHeight",
  "margin", "marginBlock", "marginBlockEnd", "marginBlockStart",
  "marginBottom", "marginInline", "marginInlineEnd", "marginInlineStart",
  "marginLeft", "marginRight", "marginTop",
  "maxHeight", "maxWidth", "minHeight", "minWidth",
  "opacity", "order", "overflow", "overflowX", "overflowY",
  "padding", "paddingBlock", "paddingBlockEnd", "paddingBlockStart",
  "paddingBottom", "paddingInline", "paddingInlineEnd", "paddingInlineStart",
  "paddingLeft", "paddingRight", "paddingTop",
  "placeContent", "placeItems", "placeSelf",
  "position", "rowGap",
  "textAlign", "top", "right", "bottom", "left",
  "transform", "verticalAlign", "whiteSpace", "width", "zIndex",
]);

/** 可能携带颜色的属性名(需额外做中性色映射)。 */
const COLOR_PROPERTY_NAMES = new Set([
  "border", "background", "backgroundColor", "borderColor",
  "borderBlock", "borderBlockEnd", "borderBlockStart",
  "borderBottom", "borderInline", "borderInlineEnd", "borderInlineStart",
  "borderLeft", "borderRight", "borderTop", "boxShadow", "color",
]);

/** 危险样式值:url( / expression( / javascript: / @import / 尖括号花括号。 */
const UNSAFE_VALUE_RE = /(?:url\s*\(|expression\s*\(|javascript:|@import|[<>{}])/i;

const PURE_NEUTRAL_HEX_RE = /#(?:000|000000|000000ff|fff|ffffff|ffffffff)\b/gi;
const PURE_NEUTRAL_KEYWORD_RE = /\b(?:black|white)\b/gi;
const RGB_COLOR_RE = /rgba?\(\s*([^)]+)\)/gi;
const HSL_COLOR_RE = /hsla?\(\s*([^)]+)\)/gi;

/** 纯中性色(黑/白)按属性类型映射到主题变量,适配暗色模式。 */
function neutralReplacement(property: string): string {
  if (property === "color") return "var(--foreground)";
  if (property === "background" || property === "backgroundColor") return "var(--background)";
  if (property === "boxShadow") return "color-mix(in oklch, var(--foreground) 16%, transparent)";
  return "var(--border)";
}

function isSafeValue(value: string | number): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  const v = value.trim();
  return Boolean(v) && v.length <= 120 && !UNSAFE_VALUE_RE.test(v);
}

function isOpaqueAlpha(alpha: string | undefined): boolean {
  if (!alpha) return true;
  return /^(?:1(?:\.0+)?|100%)$/u.test(alpha.trim());
}

function splitColor(value: string): { channels: string[]; alpha?: string } {
  const [channelPart, slashAlpha] = value.split(/\s+\/\s+/u, 2);
  if (channelPart.includes(",")) {
    const parts = channelPart.split(",").map((s) => s.trim());
    return { channels: parts.slice(0, 3), alpha: parts[3] ?? slashAlpha };
  }
  return { channels: channelPart.trim().split(/\s+/u), alpha: slashAlpha };
}

function isPureNeutralRGB(value: string): boolean {
  const { channels, alpha } = splitColor(value);
  if (channels.length !== 3 || !isOpaqueAlpha(alpha)) return false;
  return channels.every((c) => c === "0") || channels.every((c) => c === "255");
}

function isPureNeutralHSL(value: string): boolean {
  const { channels, alpha } = splitColor(value);
  if (channels.length !== 3 || !isOpaqueAlpha(alpha)) return false;
  return channels[2] === "0%" || channels[2] === "100%";
}

/** 把值里的纯中性色替换为主题变量。 */
function normalizeNeutralColor(property: string, value: string): string {
  const replacement = neutralReplacement(property);
  return value
    .replace(PURE_NEUTRAL_HEX_RE, replacement)
    .replace(PURE_NEUTRAL_KEYWORD_RE, replacement)
    .replace(RGB_COLOR_RE, (match, content: string) => (isPureNeutralRGB(content) ? replacement : match))
    .replace(HSL_COLOR_RE, (match, content: string) => (isPureNeutralHSL(content) ? replacement : match));
}

/**
 * 过滤 HTML 内联 style:白名单属性 + 危险值拦截 + 中性色映射。
 * 返回 undefined 表示无安全属性可保留(调用方可不渲染 style)。
 */
export function sanitizeHTMLStyle(style: CSSProperties | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const safe: Record<string, string | number> = {};
  for (const [property, value] of Object.entries(style)) {
    if (!SAFE_STYLE_PROPERTIES.has(property)) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    if (!isSafeValue(value)) continue;
    if (COLOR_PROPERTY_NAMES.has(property)) {
      if (typeof value === "number") continue;
      safe[property] = normalizeNeutralColor(property, value);
    } else {
      safe[property] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}
