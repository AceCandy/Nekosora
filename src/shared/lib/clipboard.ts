/**
 * 复制文本到剪贴板。
 * 优先用原生 Clipboard API(仅安全上下文可用:https / localhost),
 * 不可用或被拒绝时回退到临时 textarea + execCommand('copy'),
 * 兼容 http 局域网 IP 等非安全上下文。返回是否复制成功。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒等场景,继续走 execCommand 兜底
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
