import type {
  IRContentPart,
  IRMessage,
  IRRequest,
  IRResponseFormat,
  IRToolCall,
  IRToolChoice,
  IRToolDef,
} from "@/lib/providers/types";
import type { ReasoningLevel } from "@/db/types";
import type { ParsedGatewayRequest } from "./types";
import {
  arrayAt,
  assertAllowed,
  invalid,
  missing,
  numberAt,
  objectAt,
  stringAt,
  unsupported,
  type JsonObject,
} from "./validation";

const REASONING_LEVELS = new Set<ReasoningLevel>([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

function optionalNumber(object: JsonObject, key: string, path = key): number | undefined {
  return object[key] === undefined ? undefined : numberAt(object[key], path);
}

function parseReasoning(value: unknown, path: string): ReasoningLevel | undefined {
  if (value === undefined) return undefined;
  const level = stringAt(value, path) === "none" ? "off" : value as ReasoningLevel;
  if (!REASONING_LEVELS.has(level)) unsupported(path);
  return level;
}

function parseJsonSchema(
  value: unknown,
  path: string,
  defaultName: string,
): IRResponseFormat {
  const object = objectAt(value, path);
  const schema = object.schema ?? object.json_schema;
  if (!schema || typeof schema !== "object") missing(`${path}.schema`);
  return {
    type: "json_schema",
    json_schema: {
      name: typeof object.name === "string" ? object.name : defaultName,
      ...(typeof object.description === "string" ? { description: object.description } : {}),
      schema,
      ...(typeof object.strict === "boolean" ? { strict: object.strict } : {}),
    },
  };
}

function parseOpenAIResponseFormat(value: unknown, path: string): IRResponseFormat | undefined {
  if (value === undefined) return undefined;
  const object = objectAt(value, path);
  assertAllowed(object, ["type", "json_schema"], path);
  const type = stringAt(object.type, `${path}.type`);
  if (type === "text") return undefined;
  if (type !== "json_schema") unsupported(`${path}.type`);
  return parseJsonSchema(object.json_schema, `${path}.json_schema`, "response");
}

function parseResponsesTextFormat(value: unknown, path: string): IRResponseFormat | undefined {
  if (value === undefined) return undefined;
  const object = objectAt(value, path);
  assertAllowed(object, ["type", "name", "description", "schema", "strict"], path);
  const type = stringAt(object.type, `${path}.type`);
  if (type === "text") return undefined;
  if (type !== "json_schema") unsupported(`${path}.type`);
  return parseJsonSchema(object, path, "response");
}

function parseToolChoice(value: unknown, path: string): IRToolChoice | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (value === "auto" || value === "none" || value === "required") return value;
    unsupported(path);
  }
  const object = objectAt(value, path);
  assertAllowed(object, ["type", "function", "name"], path);
  if (object.type === "function") {
    const fn = objectAt(object.function, `${path}.function`);
    assertAllowed(fn, ["name"], `${path}.function`);
    return { type: "function", function: { name: stringAt(fn.name, `${path}.function.name`) } };
  }
  if (object.type === "tool") {
    return { type: "function", function: { name: stringAt(object.name, `${path}.name`) } };
  }
  unsupported(`${path}.type`);
}

function parseOpenAITools(value: unknown, path = "tools"): IRToolDef[] | undefined {
  if (value === undefined) return undefined;
  return arrayAt(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const object = objectAt(entry, itemPath);
    if (object.type !== "function") unsupported(`${itemPath}.type`);
    assertAllowed(object, ["type", "function", "name", "description", "parameters", "strict"], itemPath);
    const definition = object.function === undefined ? object : objectAt(object.function, `${itemPath}.function`);
    if (object.function !== undefined) {
      assertAllowed(definition, ["name", "description", "parameters", "strict"], `${itemPath}.function`);
    }
    return {
      type: "function",
      function: {
        name: stringAt(definition.name, `${itemPath}.name`),
        ...(typeof definition.description === "string" ? { description: definition.description } : {}),
        ...(definition.parameters !== undefined ? { parameters: definition.parameters } : {}),
      },
    };
  });
}

function parseToolCalls(value: unknown, path: string): IRToolCall[] | undefined {
  if (value === undefined) return undefined;
  return arrayAt(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const object = objectAt(entry, itemPath);
    assertAllowed(object, ["id", "type", "function"], itemPath);
    if (object.type !== "function") unsupported(`${itemPath}.type`);
    const fn = objectAt(object.function, `${itemPath}.function`);
    assertAllowed(fn, ["name", "arguments"], `${itemPath}.function`);
    return {
      id: stringAt(object.id, `${itemPath}.id`),
      type: "function",
      function: {
        name: stringAt(fn.name, `${itemPath}.function.name`),
        arguments: stringAt(fn.arguments, `${itemPath}.function.arguments`),
      },
    };
  });
}

function parseOpenAIContent(value: unknown, path: string, assistant = false): IRMessage["content"] {
  if (typeof value === "string") return value;
  if (value === null && assistant) return "";
  return arrayAt(value, path).map((entry, index): IRContentPart => {
    const itemPath = `${path}[${index}]`;
    const part = objectAt(entry, itemPath);
    if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
      assertAllowed(part, ["type", "text"], itemPath);
      return { type: "text", text: stringAt(part.text, `${itemPath}.text`) };
    }
    if (part.type === "image_url" || part.type === "input_image") {
      assertAllowed(part, ["type", "image_url"], itemPath);
      const image = typeof part.image_url === "string"
        ? part.image_url
        : stringAt(objectAt(part.image_url, `${itemPath}.image_url`).url, `${itemPath}.image_url.url`);
      return { type: "image_url", image_url: { url: image } };
    }
    unsupported(`${itemPath}.type`);
  });
}

function parseChatMessages(value: unknown, path = "messages"): IRMessage[] {
  const messages = arrayAt(value, path);
  if (messages.length === 0) missing(path);
  return messages.map((entry, index): IRMessage => {
    const itemPath = `${path}[${index}]`;
    const object = objectAt(entry, itemPath);
    assertAllowed(object, ["role", "content", "name", "tool_call_id", "tool_calls"], itemPath);
    const role = stringAt(object.role, `${itemPath}.role`);
    if (!["system", "developer", "user", "assistant", "tool"].includes(role)) {
      unsupported(`${itemPath}.role`);
    }
    if (role === "tool") {
      return {
        role,
        content: stringAt(object.content, `${itemPath}.content`),
        tool_call_id: stringAt(object.tool_call_id, `${itemPath}.tool_call_id`),
        ...(typeof object.name === "string" ? { name: object.name } : {}),
      };
    }
    return {
      role: role as Exclude<IRMessage["role"], "tool">,
      content: parseOpenAIContent(object.content, `${itemPath}.content`, role === "assistant"),
      ...(typeof object.name === "string" ? { name: object.name } : {}),
      ...(role === "assistant" ? { tool_calls: parseToolCalls(object.tool_calls, `${itemPath}.tool_calls`) } : {}),
    };
  });
}

/** OpenAI Chat Completions 请求 -> 统一 IR。 */
export function parseChatCompletions(body: unknown): ParsedGatewayRequest {
  const object = objectAt(body, "body");
  assertAllowed(object, [
    "model", "messages", "stream", "temperature", "max_tokens", "max_completion_tokens",
    "top_p", "stop", "tools", "tool_choice", "response_format", "reasoning_effort", "n",
    "stream_options",
  ]);
  if (object.n !== undefined && numberAt(object.n, "n") !== 1) unsupported("n");
  if (object.stream_options !== undefined) {
    const streamOptions = objectAt(object.stream_options, "stream_options");
    assertAllowed(streamOptions, ["include_usage"], "stream_options");
    if (streamOptions.include_usage !== undefined && typeof streamOptions.include_usage !== "boolean") {
      invalid("stream_options.include_usage 必须是布尔值");
    }
  }
  const model = typeof object.model === "string" ? object.model : missing("model");
  return {
    protocol: "openai-chat",
    stream: object.stream === true,
    request: {
      model,
      messages: parseChatMessages(object.messages),
      stream: object.stream === true,
      temperature: optionalNumber(object, "temperature"),
      max_tokens: optionalNumber(object, object.max_completion_tokens !== undefined ? "max_completion_tokens" : "max_tokens"),
      top_p: optionalNumber(object, "top_p"),
      stop: object.stop as string | string[] | undefined,
      tools: parseOpenAITools(object.tools),
      tool_choice: parseToolChoice(object.tool_choice, "tool_choice"),
      response_format: parseOpenAIResponseFormat(object.response_format, "response_format"),
      reasoning: parseReasoning(object.reasoning_effort, "reasoning_effort"),
    },
  };
}

function parseResponsesInput(value: unknown): IRMessage[] {
  if (typeof value === "string") return [{ role: "user", content: value }];
  const result: IRMessage[] = [];
  for (const [index, entry] of arrayAt(value, "input").entries()) {
    const path = `input[${index}]`;
    const object = objectAt(entry, path);
    if (object.type === "function_call") {
      assertAllowed(object, ["type", "id", "call_id", "name", "arguments", "status"], path);
      result.push({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: stringAt(object.call_id ?? object.id, `${path}.call_id`),
          type: "function",
          function: {
            name: stringAt(object.name, `${path}.name`),
            arguments: stringAt(object.arguments, `${path}.arguments`),
          },
        }],
      });
      continue;
    }
    if (object.type === "function_call_output") {
      assertAllowed(object, ["type", "call_id", "output", "status"], path);
      result.push({
        role: "tool",
        content: typeof object.output === "string" ? object.output : JSON.stringify(object.output),
        tool_call_id: stringAt(object.call_id, `${path}.call_id`),
      });
      continue;
    }
    assertAllowed(object, ["type", "role", "content", "status", "id"], path);
    const role = stringAt(object.role, `${path}.role`);
    if (!["system", "developer", "user", "assistant"].includes(role)) unsupported(`${path}.role`);
    result.push({
      role: role as Exclude<IRMessage["role"], "tool">,
      content: parseOpenAIContent(object.content, `${path}.content`, role === "assistant"),
    });
  }
  if (result.length === 0) missing("input");
  return result;
}

/** OpenAI Responses 请求 -> 统一 IR（首期无状态）。 */
export function parseResponses(body: unknown): ParsedGatewayRequest {
  const object = objectAt(body, "body");
  assertAllowed(object, [
    "model", "input", "stream", "temperature", "max_output_tokens", "top_p", "tools",
    "tool_choice", "text", "reasoning", "store", "previous_response_id", "conversation",
    "background",
  ]);
  for (const field of ["previous_response_id", "conversation", "background"] as const) {
    if (object[field] !== undefined) unsupported(field);
  }
  if (object.store === true) unsupported("store");
  if (object.store !== undefined && object.store !== false) invalid("store 必须是 false");
  const text = object.text === undefined ? undefined : objectAt(object.text, "text");
  if (text) assertAllowed(text, ["format", "verbosity"], "text");
  if (text?.verbosity !== undefined) unsupported("text.verbosity");
  const reasoning = object.reasoning === undefined ? undefined : objectAt(object.reasoning, "reasoning");
  if (reasoning) assertAllowed(reasoning, ["effort", "summary"], "reasoning");
  if (reasoning?.summary !== undefined) unsupported("reasoning.summary");
  const model = typeof object.model === "string" ? object.model : missing("model");
  return {
    protocol: "openai-responses",
    stream: object.stream === true,
    request: {
      model,
      messages: parseResponsesInput(object.input),
      stream: object.stream === true,
      temperature: optionalNumber(object, "temperature"),
      max_tokens: optionalNumber(object, "max_output_tokens"),
      top_p: optionalNumber(object, "top_p"),
      tools: parseOpenAITools(object.tools),
      tool_choice: parseToolChoice(object.tool_choice, "tool_choice"),
      response_format: text?.format === undefined
        ? undefined
        : parseResponsesTextFormat(text.format, "text.format"),
      reasoning: parseReasoning(reasoning?.effort, "reasoning.effort"),
    },
  };
}

function anthropicImage(part: JsonObject, path: string): IRContentPart {
  const source = objectAt(part.source, `${path}.source`);
  assertAllowed(source, ["type", "media_type", "data", "url"], `${path}.source`);
  if (source.type === "url") {
    return { type: "image_url", image_url: { url: stringAt(source.url, `${path}.source.url`) } };
  }
  if (source.type === "base64") {
    const mediaType = stringAt(source.media_type, `${path}.source.media_type`);
    const data = stringAt(source.data, `${path}.source.data`);
    return { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } };
  }
  unsupported(`${path}.source.type`);
}

function parseAnthropicMessageList(value: unknown): IRMessage[] {
  const result: IRMessage[] = [];
  for (const [index, entry] of arrayAt(value, "messages").entries()) {
    const path = `messages[${index}]`;
    const object = objectAt(entry, path);
    assertAllowed(object, ["role", "content"], path);
    const role = stringAt(object.role, `${path}.role`);
    if (role !== "user" && role !== "assistant") unsupported(`${path}.role`);
    if (typeof object.content === "string") {
      result.push({ role, content: object.content });
      continue;
    }
    const parts: IRContentPart[] = [];
    const toolCalls: IRToolCall[] = [];
    for (const [partIndex, entryPart] of arrayAt(object.content, `${path}.content`).entries()) {
      const partPath = `${path}.content[${partIndex}]`;
      const part = objectAt(entryPart, partPath);
      if (part.type === "text") {
        assertAllowed(part, ["type", "text"], partPath);
        parts.push({ type: "text", text: stringAt(part.text, `${partPath}.text`) });
      } else if (part.type === "image") {
        assertAllowed(part, ["type", "source"], partPath);
        parts.push(anthropicImage(part, partPath));
      } else if (part.type === "tool_use" && role === "assistant") {
        assertAllowed(part, ["type", "id", "name", "input"], partPath);
        toolCalls.push({
          id: stringAt(part.id, `${partPath}.id`),
          type: "function",
          function: {
            name: stringAt(part.name, `${partPath}.name`),
            arguments: JSON.stringify(part.input ?? {}),
          },
        });
      } else if (part.type === "tool_result" && role === "user") {
        assertAllowed(part, ["type", "tool_use_id", "content", "is_error"], partPath);
        result.push({
          role: "tool",
          content: typeof part.content === "string" ? part.content : JSON.stringify(part.content),
          tool_call_id: stringAt(part.tool_use_id, `${partPath}.tool_use_id`),
        });
      } else {
        unsupported(`${partPath}.type`);
      }
    }
    if (parts.length > 0 || toolCalls.length > 0) {
      result.push({ role, content: parts.length > 0 ? parts : "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    }
  }
  if (result.length === 0) missing("messages");
  return result;
}

function parseAnthropicTools(value: unknown): IRToolDef[] | undefined {
  if (value === undefined) return undefined;
  return arrayAt(value, "tools").map((entry, index) => {
    const path = `tools[${index}]`;
    const object = objectAt(entry, path);
    assertAllowed(object, ["name", "description", "input_schema", "type"], path);
    if (object.type !== undefined && object.type !== "custom") unsupported(`${path}.type`);
    return {
      type: "function",
      function: {
        name: stringAt(object.name, `${path}.name`),
        ...(typeof object.description === "string" ? { description: object.description } : {}),
        ...(object.input_schema !== undefined ? { parameters: object.input_schema } : {}),
      },
    };
  });
}

/** Anthropic Messages 请求 -> 统一 IR。 */
export function parseAnthropicMessages(body: unknown): ParsedGatewayRequest {
  const object = objectAt(body, "body");
  assertAllowed(object, [
    "model", "messages", "max_tokens", "system", "stream", "temperature", "top_p",
    "stop_sequences", "tools", "tool_choice", "output_config", "thinking",
  ]);
  if (object.thinking !== undefined) unsupported("thinking");
  const messages: IRMessage[] = [];
  if (object.system !== undefined) {
    if (typeof object.system !== "string") unsupported("system");
    messages.push({ role: "system", content: object.system });
  }
  messages.push(...parseAnthropicMessageList(object.messages));
  let responseFormat: IRResponseFormat | undefined;
  if (object.output_config !== undefined) {
    const outputConfig = objectAt(object.output_config, "output_config");
    assertAllowed(outputConfig, ["format"], "output_config");
    const format = objectAt(outputConfig.format, "output_config.format");
    assertAllowed(format, ["type", "schema", "name", "description", "strict"], "output_config.format");
    if (format.type !== "json_schema") unsupported("output_config.format.type");
    responseFormat = parseJsonSchema(format, "output_config.format", "response");
  }
  let toolChoice: IRToolChoice | undefined;
  if (object.tool_choice !== undefined) {
    const choice = objectAt(object.tool_choice, "tool_choice");
    assertAllowed(choice, ["type", "name", "disable_parallel_tool_use"], "tool_choice");
    if (choice.disable_parallel_tool_use !== undefined) unsupported("tool_choice.disable_parallel_tool_use");
    toolChoice = choice.type === "any"
      ? "required"
      : choice.type === "tool"
        ? { type: "function", function: { name: stringAt(choice.name, "tool_choice.name") } }
        : parseToolChoice(choice.type, "tool_choice.type");
  }
  const model = typeof object.model === "string" ? object.model : missing("model");
  return {
    protocol: "anthropic",
    stream: object.stream === true,
    request: {
      model,
      messages,
      stream: object.stream === true,
      temperature: optionalNumber(object, "temperature"),
      max_tokens: optionalNumber(object, "max_tokens"),
      top_p: optionalNumber(object, "top_p"),
      stop: object.stop_sequences as string[] | undefined,
      tools: parseAnthropicTools(object.tools),
      tool_choice: toolChoice,
      response_format: responseFormat,
    },
  };
}

function geminiParts(value: unknown, path: string): { content: IRContentPart[]; toolCalls: IRToolCall[]; toolResults: IRMessage[] } {
  const content: IRContentPart[] = [];
  const toolCalls: IRToolCall[] = [];
  const toolResults: IRMessage[] = [];
  for (const [index, entry] of arrayAt(value, path).entries()) {
    const partPath = `${path}[${index}]`;
    const part = objectAt(entry, partPath);
    assertAllowed(part, ["text", "inlineData", "functionCall", "functionResponse", "thought", "thoughtSignature"], partPath);
    if (part.thought !== undefined || part.thoughtSignature !== undefined) unsupported(part.thought !== undefined ? `${partPath}.thought` : `${partPath}.thoughtSignature`);
    if (part.text !== undefined) {
      content.push({ type: "text", text: stringAt(part.text, `${partPath}.text`) });
    } else if (part.inlineData !== undefined) {
      const data = objectAt(part.inlineData, `${partPath}.inlineData`);
      assertAllowed(data, ["mimeType", "data"], `${partPath}.inlineData`);
      content.push({
        type: "image_url",
        image_url: { url: `data:${stringAt(data.mimeType, `${partPath}.inlineData.mimeType`)};base64,${stringAt(data.data, `${partPath}.inlineData.data`)}` },
      });
    } else if (part.functionCall !== undefined) {
      const call = objectAt(part.functionCall, `${partPath}.functionCall`);
      assertAllowed(call, ["id", "name", "args"], `${partPath}.functionCall`);
      toolCalls.push({
        id: typeof call.id === "string" ? call.id : `call_${crypto.randomUUID()}`,
        type: "function",
        function: {
          name: stringAt(call.name, `${partPath}.functionCall.name`),
          arguments: JSON.stringify(call.args ?? {}),
        },
      });
    } else if (part.functionResponse !== undefined) {
      const response = objectAt(part.functionResponse, `${partPath}.functionResponse`);
      assertAllowed(response, ["id", "name", "response"], `${partPath}.functionResponse`);
      toolResults.push({
        role: "tool",
        name: stringAt(response.name, `${partPath}.functionResponse.name`),
        tool_call_id: typeof response.id === "string" ? response.id : response.name as string,
        content: JSON.stringify(response.response ?? {}),
      });
    } else {
      unsupported(partPath);
    }
  }
  return { content, toolCalls, toolResults };
}

function parseGeminiContents(value: unknown): IRMessage[] {
  const result: IRMessage[] = [];
  for (const [index, entry] of arrayAt(value, "contents").entries()) {
    const path = `contents[${index}]`;
    const object = objectAt(entry, path);
    assertAllowed(object, ["role", "parts"], path);
    const role = object.role === undefined ? "user" : stringAt(object.role, `${path}.role`);
    if (role !== "user" && role !== "model") unsupported(`${path}.role`);
    const parts = geminiParts(object.parts, `${path}.parts`);
    result.push(...parts.toolResults);
    if (parts.content.length > 0 || parts.toolCalls.length > 0) {
      result.push({
        role: role === "model" ? "assistant" : "user",
        content: parts.content.length ? parts.content : "",
        ...(parts.toolCalls.length ? { tool_calls: parts.toolCalls } : {}),
      });
    }
  }
  if (result.length === 0) missing("contents");
  return result;
}

function parseGeminiTools(value: unknown): IRToolDef[] | undefined {
  if (value === undefined) return undefined;
  const declarations: unknown[] = [];
  for (const [index, entry] of arrayAt(value, "tools").entries()) {
    const path = `tools[${index}]`;
    const object = objectAt(entry, path);
    assertAllowed(object, ["functionDeclarations"], path);
    declarations.push(...arrayAt(object.functionDeclarations, `${path}.functionDeclarations`));
  }
  return declarations.map((entry, index) => {
    const path = `tools.functionDeclarations[${index}]`;
    const object = objectAt(entry, path);
    assertAllowed(object, ["name", "description", "parameters", "parametersJsonSchema"], path);
    return {
      type: "function",
      function: {
        name: stringAt(object.name, `${path}.name`),
        ...(typeof object.description === "string" ? { description: object.description } : {}),
        parameters: object.parametersJsonSchema ?? object.parameters ?? {},
      },
    };
  });
}

/** Gemini GenerateContent 请求 -> 统一 IR。 */
export function parseGeminiGenerateContent(
  body: unknown,
  model: string,
  stream: boolean,
): ParsedGatewayRequest {
  const object = objectAt(body, "body");
  assertAllowed(object, ["contents", "systemInstruction", "generationConfig", "tools", "toolConfig"]);
  const messages: IRMessage[] = [];
  if (object.systemInstruction !== undefined) {
    const system = objectAt(object.systemInstruction, "systemInstruction");
    assertAllowed(system, ["parts", "role"], "systemInstruction");
    const parts = geminiParts(system.parts, "systemInstruction.parts");
    if (parts.toolCalls.length || parts.toolResults.length || parts.content.some((part) => part.type !== "text")) {
      unsupported("systemInstruction.parts");
    }
    messages.push({ role: "system", content: parts.content.map((part) => part.text ?? "").join("\n") });
  }
  messages.push(...parseGeminiContents(object.contents));
  const config = object.generationConfig === undefined ? undefined : objectAt(object.generationConfig, "generationConfig");
  if (config) assertAllowed(config, [
    "temperature", "topP", "maxOutputTokens", "stopSequences", "candidateCount",
    "responseMimeType", "responseSchema", "responseJsonSchema", "thinkingConfig",
  ], "generationConfig");
  if (config?.candidateCount !== undefined && numberAt(config.candidateCount, "generationConfig.candidateCount") !== 1) {
    unsupported("generationConfig.candidateCount");
  }
  if (config?.thinkingConfig !== undefined) unsupported("generationConfig.thinkingConfig");
  let responseFormat: IRResponseFormat | undefined;
  const schema = config?.responseJsonSchema ?? config?.responseSchema;
  if (schema !== undefined) {
    if (config?.responseMimeType !== undefined && config.responseMimeType !== "application/json") {
      unsupported("generationConfig.responseMimeType");
    }
    responseFormat = {
      type: "json_schema",
      json_schema: { name: "response", schema },
    };
  } else if (config?.responseMimeType !== undefined && config.responseMimeType !== "text/plain") {
    unsupported("generationConfig.responseMimeType");
  }
  let toolChoice: IRToolChoice | undefined;
  if (object.toolConfig !== undefined) {
    const toolConfig = objectAt(object.toolConfig, "toolConfig");
    assertAllowed(toolConfig, ["functionCallingConfig"], "toolConfig");
    const calling = objectAt(toolConfig.functionCallingConfig, "toolConfig.functionCallingConfig");
    assertAllowed(calling, ["mode", "allowedFunctionNames"], "toolConfig.functionCallingConfig");
    const mode = stringAt(calling.mode, "toolConfig.functionCallingConfig.mode").toUpperCase();
    if (mode === "AUTO") toolChoice = "auto";
    else if (mode === "NONE") toolChoice = "none";
    else if (mode === "ANY") {
      const names = calling.allowedFunctionNames === undefined
        ? []
        : arrayAt(calling.allowedFunctionNames, "toolConfig.functionCallingConfig.allowedFunctionNames").map((name, index) =>
            stringAt(name, `toolConfig.functionCallingConfig.allowedFunctionNames[${index}]`));
      if (names.length > 1) unsupported("toolConfig.functionCallingConfig.allowedFunctionNames");
      toolChoice = names.length === 1
        ? { type: "function", function: { name: names[0] } }
        : "required";
    } else unsupported("toolConfig.functionCallingConfig.mode");
  }
  return {
    protocol: "gemini",
    stream,
    request: {
      model,
      messages,
      stream,
      temperature: config ? optionalNumber(config, "temperature", "generationConfig.temperature") : undefined,
      max_tokens: config ? optionalNumber(config, "maxOutputTokens", "generationConfig.maxOutputTokens") : undefined,
      top_p: config ? optionalNumber(config, "topP", "generationConfig.topP") : undefined,
      stop: config?.stopSequences as string[] | undefined,
      tools: parseGeminiTools(object.tools),
      tool_choice: toolChoice,
      response_format: responseFormat,
    },
  };
}
