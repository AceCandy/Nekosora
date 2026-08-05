import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CONVERSATION_TITLE_QUEUE,
  FILE_PROCESS_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  type ConversationTitlePayload,
  type FileProcessPayload,
  type MemoryExtractionPayload,
  type QueuePayload,
} from "./catalog";

const EXPECTED_POLICY = {
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 900,
};

describe("job catalog", () => {
  it("集中定义三个队列的名称、重试策略与安全错误", () => {
    expect(FILE_PROCESS_QUEUE).toEqual({
      name: "file-process",
      policy: EXPECTED_POLICY,
      retryMessage: "文件处理失败，可重试",
    });
    expect(MEMORY_EXTRACTION_QUEUE).toEqual({
      name: "memory-extract",
      policy: EXPECTED_POLICY,
      retryMessage: "记忆提取失败",
    });
    expect(CONVERSATION_TITLE_QUEUE).toEqual({
      name: "conversation-title",
      policy: EXPECTED_POLICY,
      retryMessage: "会话标题生成失败",
    });
  });

  it("队列 payload 只包含 durable fact id", () => {
    expectTypeOf<QueuePayload<typeof FILE_PROCESS_QUEUE>>()
      .toEqualTypeOf<FileProcessPayload>();
    expectTypeOf<FileProcessPayload>().toEqualTypeOf<{ fileId: string }>();
    expectTypeOf<QueuePayload<typeof MEMORY_EXTRACTION_QUEUE>>()
      .toEqualTypeOf<MemoryExtractionPayload>();
    expectTypeOf<MemoryExtractionPayload>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<QueuePayload<typeof CONVERSATION_TITLE_QUEUE>>()
      .toEqualTypeOf<ConversationTitlePayload>();
    expectTypeOf<ConversationTitlePayload>().toEqualTypeOf<{ id: string }>();
  });
});
