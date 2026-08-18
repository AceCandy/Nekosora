import type { QueueAdapter } from "@nekusora/contracts/queue";

type QueueProvider = () => Promise<QueueAdapter>;

const QUEUE_PROVIDER = Symbol.for("@nekusora/core/queue-provider");
const queueState = globalThis as typeof globalThis & {
  [QUEUE_PROVIDER]?: QueueProvider;
};

/** 由拥有队列驱动的进程在启动时注入。 */
export function configureQueueProvider(provider: QueueProvider): void {
  queueState[QUEUE_PROVIDER] = provider;
}

/** 获取当前进程的队列；未配置时由调用方执行既有降级路径。 */
export function getQueue(): Promise<QueueAdapter> {
  const provider = queueState[QUEUE_PROVIDER];
  if (!provider) {
    return Promise.reject(new Error("当前进程未配置队列驱动"));
  }
  return provider();
}

export type { QueueAdapter } from "@nekusora/contracts/queue";
