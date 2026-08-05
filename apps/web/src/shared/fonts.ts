import localFont from "next/font/local";

/**
 * Inter（西文正文/标题）—— 现代无衬线,与 Noto Sans SC 搭配中英混排。
 * 400 Regular / 500 Medium / 600 SemiBold
 */
export const inter = localFont({
  src: [
    { path: "../fonts/Inter-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Inter-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Inter-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

/**
 * JetBrains Mono（等宽字体）—— 代码块、行内代码、数字/配置标识。
 * 400 Regular / 500 Medium / 600 SemiBold
 */
export const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/JetBrainsMono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/JetBrainsMono-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/JetBrainsMono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

/**
 * Noto Sans SC（简体中文）—— subset 常用字 + CJK 全范围 + 标点符号。
 * 用于 Inter 不覆盖的中文字符回退。
 * 400 Regular / 500 Medium / 600 SemiBold
 */
export const notoSansSC = localFont({
  src: [
    { path: "../fonts/NotoSansSC-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/NotoSansSC-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/NotoSansSC-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-cjk",
  display: "swap",
});