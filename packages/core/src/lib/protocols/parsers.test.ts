import { describe, expect, it } from "vitest";
import {
  parseAnthropicMessages,
  parseChatCompletions,
  parseGeminiGenerateContent,
  parseResponses,
} from "./parsers";
import { UnsupportedParameterError } from "./validation";

function expectUnsupported(run: () => unknown, parameter: string) {
  try {
    run();
    throw new Error("预期抛出 UnsupportedParameterError");
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedParameterError);
    expect((error as UnsupportedParameterError).parameter).toBe(parameter);
    expect((error as Error).message).toBe(`Unsupported parameter: '${parameter}'.`);
  }
}

describe("multi-protocol parsers", () => {
  it("Chat Completions 解析文本、图片、工具和 JSON Schema", () => {
    const parsed = parseChatCompletions({
      model: "model-a",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
        ],
      }],
      tools: [{ type: "function", function: { name: "weather", parameters: { type: "object" } } }],
      tool_choice: { type: "function", function: { name: "weather" } },
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" }, strict: true },
      },
      reasoning_effort: "high",
    });
    expect(parsed.request).toMatchObject({
      model: "model-a",
      reasoning: "high",
      tool_choice: { type: "function", function: { name: "weather" } },
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" }, strict: true },
      },
    });
    expect(parsed.request.messages[0].content).toEqual([
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ]);
  });

  it("Chat Completions 接受标准 stream_options.include_usage", () => {
    const parsed = parseChatCompletions({
      model: "model-a",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      stream_options: { include_usage: true },
    });

    expect(parsed.stream).toBe(true);
    expect(parsed.request).not.toHaveProperty("stream_options");
    expect(() => parseChatCompletions({
      model: "model-a",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      stream_options: { include_usage: "true" },
    })).toThrow("stream_options.include_usage 必须是布尔值");
  });

  it("Chat Completions 拒绝未知顶层字段和多候选", () => {
    expectUnsupported(() => parseChatCompletions({ model: "m", messages: [{ role: "user", content: "x" }], logprobs: true }), "logprobs");
    expectUnsupported(() => parseChatCompletions({ model: "m", messages: [{ role: "user", content: "x" }], n: 2 }), "n");
    expectUnsupported(() => parseChatCompletions({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: true,
      stream_options: { include_cost: true },
    }), "stream_options.include_cost");
  });

  it("Responses 解析无状态文本与 function call/result", () => {
    const parsed = parseResponses({
      model: "model-a",
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "hello" },
            { type: "input_image", image_url: "https://example.com/a.png" },
          ],
        },
        { type: "function_call", call_id: "call-1", name: "weather", arguments: "{}" },
        { type: "function_call_output", call_id: "call-1", output: "sunny" },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          schema: { type: "object" },
          strict: true,
        },
      },
      reasoning: { effort: "medium" },
    });
    expect(parsed.request.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(parsed.request.messages[0].content).toEqual([
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ]);
    expect(parsed.request).toMatchObject({
      reasoning: "medium",
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" }, strict: true },
      },
    });
  });

  it("Responses 在触网前拒绝状态字段与文件", () => {
    expectUnsupported(() => parseResponses({ model: "m", input: "x", store: true }), "store");
    expectUnsupported(() => parseResponses({ model: "m", input: "x", previous_response_id: "resp-1" }), "previous_response_id");
    expectUnsupported(() => parseResponses({ model: "m", input: [{ role: "user", content: [{ type: "input_file", file_id: "file-1" }] }] }), "input[0].content[0].type");
  });

  it.each(["auto", "concise", "detailed"] as const)("Responses 接受 reasoning.summary=%s", (summary) => {
    expect(parseResponses({
      model: "m",
      input: "x",
      reasoning: { summary },
    }).request.reasoning_summary).toBe(summary);
  });

  it("Responses 拒绝非法 reasoning.summary", () => {
    expectUnsupported(() => parseResponses({
      model: "m",
      input: "x",
      reasoning: { summary: "full" },
    }), "reasoning.summary");
  });

  it("Anthropic Messages 解析 system、tool_use 和 tool_result", () => {
    const parsed = parseAnthropicMessages({
      model: "model-a",
      max_tokens: 128,
      system: "system",
      messages: [
        {
          role: "user",
          content: [{
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
          }],
        },
        { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "weather", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "sunny" }] },
      ],
      output_config: {
        format: { type: "json_schema", name: "answer", schema: { type: "object" }, strict: true },
      },
    });
    expect(parsed.request.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(parsed.request.messages[1].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);
    expect(parsed.request.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", schema: { type: "object" }, strict: true },
    });
  });

  it("Anthropic Messages 拒绝专有缓存字段", () => {
    expectUnsupported(() => parseAnthropicMessages({
      model: "m",
      messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] }],
    }), "messages[0].content[0].cache_control");
  });

  it("Gemini 从 path 模型和 contents 生成统一请求", () => {
    const parsed = parseGeminiGenerateContent({
      systemInstruction: { parts: [{ text: "system" }] },
      contents: [{
        role: "user",
        parts: [
          { text: "hello" },
          { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
        ],
      }],
      generationConfig: {
        temperature: 0.5,
        candidateCount: 1,
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object" },
      },
    }, "gemini-test", false);
    expect(parsed.request).toMatchObject({ model: "gemini-test", temperature: 0.5 });
    expect(parsed.request.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(parsed.request.messages[1].content).toEqual([
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);
    expect(parsed.request.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "response", schema: { type: "object" } },
    });
  });

  it("Gemini 拒绝多候选、文件和数值思考预算", () => {
    expectUnsupported(() => parseGeminiGenerateContent({
      contents: [{ parts: [{ text: "x" }] }],
      generationConfig: { candidateCount: 2 },
    }, "m", false), "generationConfig.candidateCount");
    expectUnsupported(() => parseGeminiGenerateContent({
      contents: [{ parts: [{ fileData: { fileUri: "gs://secret" } }] }],
    }, "m", false), "contents[0].parts[0].fileData");
    expectUnsupported(() => parseGeminiGenerateContent({
      contents: [{ parts: [{ text: "x" }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    }, "m", false), "generationConfig.thinkingConfig");
  });
});
