/**
 * 进程级错误兜底 —— 捕获上游 fetch(undici)在网络抖动或连接被关时泄漏的未捕获 rejection。
 *
 * 独立成模块,由 instrumentation.ts 在确认 Node runtime 后动态加载,
 * 避免 Edge runtime 执行 process.on。
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

  // 把异常的 constructor / code / stack / cause 链打成多行,定位 "Socket closed unexpectedly"
  // 到底来自哪类对象(Node 内置 undici 通常 code=UND_ERR_SOCKET;AI SDK wrap 后看 cause 链)。
  // 默认 console.warn(label, err) 在这类 err 上常只显示 [Error: msg] 不带 stack,显式取字段规避。
  const dumpError = (label: string, err: unknown): void => {
    if (err instanceof Error) {
      const e = err as Error & { code?: unknown; cause?: unknown };
      const parts = [`${label} ${e.constructor.name}: ${e.message}`, `  code=${String(e.code ?? "(none)")}`];
      if (e.stack) parts.push(`  stack=\n${e.stack}`);
      let cause = e.cause;
      for (let i = 0; cause && i < 3; i++) {
        const c = cause as Error & { code?: unknown; cause?: unknown };
        parts.push(
          `  cause[${i}]=${c?.constructor?.name ?? typeof cause}: ${c instanceof Error ? c.message : String(cause)} code=${String(c?.code ?? "(none)")}`,
        );
        cause = c?.cause;
      }
      console.warn(parts.join("\n"));
    } else {
      console.warn(`${label} non-Error(${typeof err}):`, err);
    }
  };

  process.on("unhandledRejection", (reason) => {
    if (isSocketNoise(reason)) {
      dumpError("[兜底][unhandledRejection] socket 噪声降级:", reason);
      return;
    }
    console.error("[unhandledRejection]", reason);
  });

  process.on("uncaughtException", (err) => {
    if (isSocketNoise(err)) {
      dumpError("[兜底][uncaughtException] socket 噪声降级:", err);
      return;
    }
    console.error("[uncaughtException]", err);
  });
}
