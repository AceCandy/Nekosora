/**
 * 进程级错误兜底 —— 捕获上游 fetch(undici)在网络抖动或连接被关时泄漏的未捕获 rejection。
 *
 * 独立成模块并通过 instrumentation.ts 的「变量路径 dynamic import」加载,让 Edge 编译
 * 预扫描不会把 process.on 拉进 Edge runtime 图(Edge 不支持 process.on,会编译失败)。
 *
 * 背景:AI SDK v5 streamText/generateText 在底层 undici socket 中途关闭时,部分内部派生
 * promise(usage/finishReason 等)的 rejection 不在所有路径上被 SDK 自身 catch,冒泡成
 * unhandledRejection → Node 24(默认 --unhandled-rejections=throw)升级为 uncaughtException,
 * 在 `next dev --turbopack` 下反复冲击会让进程进入坏状态、页面卡死。
 * 已知的 socket 类噪声降级为 warn 不再冲击进程;真正未预期的异常仍完整打印,便于排查。
 */
let _installed = false;

export function installGlobalErrorGuards(): void {
  if (_installed) return;
  _installed = true;

  const isSocketNoise = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return /socket closed unexpectedly|other side closed|UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
  };

  process.on("unhandledRejection", (reason) => {
    if (isSocketNoise(reason)) {
      // 打印完整对象(含 stack),首次复现时可据此确认是否来自 AI SDK 内部派生 promise。
      console.warn("[兜底] socket 类未捕获 rejection 已降级:", reason);
      return;
    }
    console.error("[unhandledRejection]", reason);
  });

  process.on("uncaughtException", (err) => {
    if (isSocketNoise(err)) {
      console.warn("[兜底] socket 类未捕获异常已降级:", err);
      return;
    }
    console.error("[uncaughtException]", err);
  });
}
