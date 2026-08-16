import type { QueueAdapter } from "@nekusora/contracts/queue";

type QueueProvider = () => Promise<QueueAdapter>;

let queueProvider: QueueProvider | undefined;

/** 由拥有队列驱动的进程在启动时注入。 */
export function configureQueueProvider(provider: QueueProvider): void {
  queueProvider = provider;
}

/** 获取当前进程的队列；未配置时由调用方执行既有降级路径。 */
export function getQueue(): Promise<QueueAdapter> {
  if (!queueProvider) {
    return Promise.reject(new Error("当前进程未配置队列驱动"));
  }
  return queueProvider();
}

export type { QueueAdapter } from "@nekusora/contracts/queue";
