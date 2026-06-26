/**
 * HTML Artifact 预览 —— 把模型输出的 HTML 包装成可安全渲染的 iframe srcDoc。
 *
 * 方案(借鉴 DEEIX + AMC):
 *   - srcDoc 注入 iframe,sandbox="allow-scripts"(不开 allow-same-origin,隔离成 unique origin)
 *   - CSP meta 双保险:default-src 'none',只放行 inline script/style 与 data/blob 图片
 *   - 注入 bridge 脚本:ResizeObserver + MutationObserver 监听内容高度 → postMessage 上报父窗口
 *   - 父窗口据此动态调整 iframe 高度,实现内容驱动的高度自适应
 *
 * 消息协议:{ source: "neku-html-preview", event: "resize", height: number }
 */

const PREVIEW_MESSAGE_SOURCE = "neku-html-preview";

/** iframe 内注入的 bridge 脚本:监听高度变化并上报。 */
const BRIDGE_SCRIPT = `
(function () {
  var SRC = ${JSON.stringify(PREVIEW_MESSAGE_SOURCE)};
  function measure() {
    var b = document.body, d = document.documentElement;
    return Math.max(
      b ? b.scrollHeight : 0,
      b ? b.offsetHeight : 0,
      d ? d.scrollHeight : 0,
      d ? d.offsetHeight : 0
    );
  }
  var raf = 0;
  function notify() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      parent.postMessage({ source: SRC, event: "resize", height: measure() }, "*");
    });
  }
  // 监听 DOM 变化与资源加载(图片等异步改变高度)
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(notify).observe(document.body);
  }
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(notify).observe(document.body, { childList: true, subtree: true, attributes: true });
  }
  window.addEventListener("load", notify);
  window.addEventListener("resize", notify);
  // 首次上报
  notify();
})();
`;

/**
 * 把 HTML 内容包装成完整的预览文档(含 CSP + bridge 脚本)。
 * 若已是完整文档(含 <html>),则在其内插入 CSP/bridge;否则拼一个最小文档。
 */
export function buildHtmlPreviewDoc(html: string): string {
  const csp =
    "default-src 'none'; " +
    "script-src 'unsafe-inline'; " +
    "style-src 'unsafe-inline'; " +
    "img-src data: blob: https:; " +
    "font-src data: https:; " +
    "media-src data: blob:; " +
    "connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";

  const isFullDoc = /<html[\s>]/i.test(html);

  if (isFullDoc) {
    // 完整文档:在 <head> 注入 CSP,在 </body> 前注入 bridge
    let doc = html;
    if (/<head[\s>]/i.test(doc)) {
      doc = doc.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">`);
    } else if (/<html[\s>]/i.test(doc)) {
      doc = doc.replace(/<html([^>]*)>/i, `<html$1><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head>`);
    }
    if (/<\/body>/i.test(doc)) {
      doc = doc.replace(/<\/body>/i, `<script>${BRIDGE_SCRIPT}</script></body>`);
    } else {
      doc += `<script>${BRIDGE_SCRIPT}</script>`;
    }
    return doc;
  }

  // 片段:拼最小文档
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html,body{margin:0;padding:8px;background:transparent;color:inherit;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;}
  body{color:#111827;}
  @media (prefers-color-scheme: dark){body{color:#e5e7eb;}}
</style>
</head>
<body>
${html}
<script>${BRIDGE_SCRIPT}</script>
</body>
</html>`;
}

/** 判断 postMessage 事件是否来自预览 bridge。 */
export function isPreviewResizeMessage(
  data: unknown,
): data is { source: string; event: "resize"; height: number } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: string }).source === PREVIEW_MESSAGE_SOURCE &&
    (data as { event?: string }).event === "resize" &&
    typeof (data as { height?: number }).height === "number"
  );
}

/** iframe 用的 sandbox 值:仅允许脚本(隔离同源,最安全)。 */
export const HTML_PREVIEW_SANDBOX = "allow-scripts";

/** 最小高度(避免内容极少时 iframe 塌陷)。 */
export const MIN_PREVIEW_HEIGHT = 120;
/** 默认高度(首次上报前)。 */
export const DEFAULT_PREVIEW_HEIGHT = 320;
