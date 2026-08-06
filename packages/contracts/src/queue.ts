declare const queuePayloadType: unique symbol;

export type JobOutcome = "completed" | "noop";

export interface QueuePolicy {
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
}

/** Producer 与 Worker 共享的任务传输契约。 */
export interface QueueDefinition<TPayload extends object> {
  readonly name: string;
  readonly policy: QueuePolicy;
  readonly retryMessage: string;
  readonly [queuePayloadType]?: TPayload;
}

export type QueuePayload<TDefinition extends QueueDefinition<object>> =
  TDefinition extends QueueDefinition<infer TPayload> ? TPayload : never;

export type JobHandler<T = unknown> = (data: T) => Promise<JobOutcome>;

export interface QueueAdapter {
  readonly available: boolean;
  send<TDefinition extends QueueDefinition<object>>(
    definition: TDefinition,
    data: NoInfer<QueuePayload<TDefinition>>,
    opts?: { startAfter?: number },
  ): Promise<string>;
  work<TDefinition extends QueueDefinition<object>>(
    definition: TDefinition,
    handler: JobHandler<QueuePayload<TDefinition>>,
  ): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface FileProcessPayload {
  fileId: string;
}

export interface MemoryExtractionPayload {
  id: string;
}

export interface ConversationTitlePayload {
  id: string;
}

const DEFAULT_QUEUE_POLICY: QueuePolicy = Object.freeze({
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 900,
});

export const FILE_PROCESS_QUEUE: QueueDefinition<FileProcessPayload> = Object.freeze({
  name: "file-process",
  policy: DEFAULT_QUEUE_POLICY,
  retryMessage: "文件处理失败，可重试",
});

export const MEMORY_EXTRACTION_QUEUE: QueueDefinition<MemoryExtractionPayload> = Object.freeze({
  name: "memory-extract",
  policy: DEFAULT_QUEUE_POLICY,
  retryMessage: "记忆提取失败",
});

export const CONVERSATION_TITLE_QUEUE: QueueDefinition<ConversationTitlePayload> = Object.freeze({
  name: "conversation-title",
  policy: DEFAULT_QUEUE_POLICY,
  retryMessage: "会话标题生成失败",
});
