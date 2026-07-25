import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stream", () => ({ generateChat: mockGenerateChat }));

import { createNekosoraLLM, toIRMessages } from "./nekosora-llm";

describe("Nekosora Mem0 LLM adapter", () => {
  beforeEach(() => mockGenerateChat.mockReset());

  it("将 LangChain 消息转换为 IR，并把 json_object 映射为 json", async () => {
    mockGenerateChat.mockResolvedValue({ text: '{"memories":[]}' });
    const llm = createNekosoraLLM({ modelId: "m1", modelName: "model-one" });

    const result = await llm.invoke([
      { type: "system", content: "system" },
      { type: "human", content: [{ type: "text", text: "hello" }] },
      { type: "ai", content: "answer" },
    ], { response_format: { type: "json_object" } });

    expect(result).toEqual({ content: '{"memories":[]}', role: "assistant" });
    expect(mockGenerateChat).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "m1",
      taskKind: "memory",
      output: "json",
      ctx: { userId: "", keyKind: null, source: "chat" },
      request: expect.objectContaining({
        model: "model-one",
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "answer" },
        ],
      }),
    }));
  });

  it("传播统一执行核心的错误", async () => {
    mockGenerateChat.mockResolvedValue({ text: "", error: "upstream failed" });
    const llm = createNekosoraLLM({ modelId: "m1", modelName: "model-one" });
    await expect(llm.invoke([{ role: "user", content: "hello" }])).rejects.toThrow("upstream failed");
  });

  it("支持直接检查消息转换结果", () => {
    expect(toIRMessages([{ role: "tool", content: "result" }])).toEqual([
      { role: "tool", content: "result" },
    ]);
  });
});
