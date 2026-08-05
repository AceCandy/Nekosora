"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** 与全局正文一致的字体栈,让图内文字融入排版。 */
const FONT_STACK = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

// 冷调品牌配色,对齐「暮色微澜黑与星云纯白」:蓝灰为主、不用暖色。
// 亮/暗两套,跟随系统主题切换重渲。
const LIGHT_VARS = {
  primaryColor: "#eef4fc",
  primaryBorderColor: "#9bbde8",
  primaryTextColor: "#28384f",
  secondaryColor: "#f0eefb",
  secondaryBorderColor: "#bcb6e8",
  tertiaryColor: "#e9f5f3",
  tertiaryBorderColor: "#9cd2c9",
  lineColor: "#7d93b4",
  textColor: "#28384f",
};
const DARK_VARS = {
  primaryColor: "#22324a",
  primaryBorderColor: "#3f5a86",
  primaryTextColor: "#dfe8f5",
  secondaryColor: "#2c2444",
  secondaryBorderColor: "#4a3f72",
  tertiaryColor: "#1e3340",
  tertiaryBorderColor: "#2f6473",
  lineColor: "#8aa0c4",
  textColor: "#dfe8f5",
};

/**
 * Mermaid 图渲染器:动态载入 mermaid,异步 render 成 SVG。
 *
 * 被右侧 Artifact 面板与消息正文内联 mermaid 块共用(避免两处重复维护)。
 * theme="base" + 冷调 themeVariables + look="neo"(圆角现代观感);
 * 跟随系统明暗在两套配色间切换,主题变化时重渲。content 非法(如被转义的坏语法)
 * 时显示渲染失败提示,而非抛错崩溃。id 需调用方保证唯一,避免 mermaid DOM 节点 id 冲突。
 */
export function MermaidDiagram({ id, content }: { id: string; content: string }) {
  const t = useTranslations("artifacts");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );

  // 监听主题切换,用对应配色重渲。
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setIsDark(el.classList.contains("dark"));
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          // 渲染失败时不画 mermaid 自带的错误 SVG(会以「Syntax error in text /
          // mermaid version x.x.x」残留在 body 末尾),改由下方 catch 统一提示。
          suppressErrorRendering: true,
          look: "neo",
          theme: "base",
          themeVariables: {
            ...(isDark ? DARK_VARS : LIGHT_VARS),
            fontFamily: FONT_STACK,
            fontSize: "14px",
          },
          flowchart: { curve: "rounded", padding: 16 },
        });
        const { svg: rendered } = await mermaid.render(`m-${id}`, content);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "render_failed");
      }
    })();
    return () => { cancelled = true; };
  }, [id, content, isDark]);

  if (error) return <div className="text-ui-caption text-neutral-450 dark:text-neutral-500 p-3">{t("mermaidFailed")} {error}</div>;
  if (!svg) return <div className="text-ui-caption text-neutral-450 dark:text-neutral-500 animate-pulse">{t("rendering")}</div>;
  return <div className="flex items-center justify-center min-h-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
