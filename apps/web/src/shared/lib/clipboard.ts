/**
 * 复制文本到剪贴板。
 * 优先用原生 Clipboard API(仅安全上下文可用:https / localhost),
 * 不可用或被拒绝时回退到临时 textarea + execCommand('copy'),
 * 兼容 http 局域网 IP 等非安全上下文。返回是否复制成功。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒等场景,继续走 execCommand 兜底
  }
  let textarea: HTMLTextAreaElement | null = null;
  let container: Element | null = null;
  let appended = false;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    container = document.activeElement?.closest("dialog[open]") ?? document.body;
    container.appendChild(textarea);
    appended = true;
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (appended && textarea && container) {
      try {
        container.removeChild(textarea);
      } catch { /* cleanup best effort */ }
    }
  }
}
