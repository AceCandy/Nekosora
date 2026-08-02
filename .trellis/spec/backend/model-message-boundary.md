# Model Message Boundary

## 1. Scope / Trigger

Apply this contract whenever OpenAI-compatible request IR is passed to AI SDK `streamText` or `generateText`. The project IR follows OpenAI Chat Completions, while AI SDK 7 validates different message and tool shapes at runtime. This includes multimodal user content, Agent-loop tool messages, and `IRToolDef[]` definitions.

## 2. Signatures

```typescript
toModelMessages(messages: IRMessage[]): ModelMessage[]
toModelTools(tools?: IRToolDef[]): ToolSet | undefined
separateSystem(request: IRRequest): { system: string | undefined; messages: ModelMessage[] }
```

Both generation paths must consume the `messages` returned by `separateSystem`.

## 3. Contracts

- Preserve plain string messages that already match `ModelMessage`.
- Convert user `{ type: "text", text }` parts to AI SDK text parts.
- Convert user `{ type: "image_url", image_url: { url } }` parts to `{ type: "file", data: new URL(url), mediaType: "image" }`.
- Keep OpenAI `image_url` in the shared IR and gateway API; conversion belongs only at the AI SDK boundary.
- A `data:` URL is passed as a `URL` so AI SDK extracts its concrete media type and base64 content. Remote URLs remain URL-backed file parts.
- Convert OpenAI assistant `tool_calls` to AI SDK assistant content parts with `type: "tool-call"`, `toolCallId`, `toolName`, and parsed `input`.
- Convert OpenAI `role: "tool"` messages to AI SDK tool content parts with `type: "tool-result"`, the matching call ID/name, and a text `output`.
- Keep the Agent loop's working history in the shared OpenAI IR. Perform the conversion only when a generation request crosses into AI SDK.
- Convert the OpenAI `IRToolDef[]` array into an AI SDK `ToolSet` record keyed by `function.name`; an array cast produces numeric tool names such as `"0"`.
- Wrap each `function.parameters` value with AI SDK `jsonSchema()`. Missing parameters use an empty object schema.
- Do not add `execute` to converted tools because the project Agent loop executes logical and MCP tools. AI SDK 7 therefore also requires an `outputSchema`, although only the input schema is sent upstream.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Valid remote or `data:` image URL | Convert to an AI SDK file part |
| Missing `image_url.url` | Throw `消息无效:图片缺少 URL` before the provider call |
| Malformed URL | `URL` construction fails before the provider call |
| Raw `image_url` reaches AI SDK | Runtime `ModelMessage[]` schema validation fails |
| Valid assistant `tool_calls` plus matching tool results | Convert both roles to AI SDK content-part arrays |
| Tool-call arguments are not valid JSON | JSON parsing fails before the provider call |
| Tool result lacks a call ID or resolvable tool name | Throw a stable `消息无效:*` error before the provider call |
| Raw OpenAI `tool_calls` / `tool_call_id` reaches AI SDK | Runtime `ModelMessage[]` schema validation fails |
| `IRToolDef[]` is cast directly to `ToolSet` | AI SDK enumerates array indexes, so the provider receives tool name `"0"` and an empty schema |
| Tool parameters are absent | Use an empty object input schema |

## 5. Good / Base / Bad Cases

- Good: mixed text plus remote and inline images converts without changing order.
- Good: one assistant turn containing one or more tool calls is followed by matching AI SDK tool-result messages.
- Base: a string user message remains unchanged.
- Bad: passing OpenAI image or tool-message IR directly to AI SDK fails runtime schema validation.

## 6. Tests Required

- Assert the converted messages pass `modelMessageSchema`.
- Run converted remote and `data:` URLs through `generateText` with `MockLanguageModelV4`.
- Assert the provider prompt keeps the remote URL and decodes the inline MIME/base64 data.
- Assert pure text remains unchanged and both `streamText` and `generateText` use `separateSystem` output.
- Assert the second Agent-loop generation receives AI SDK `tool-call` and `tool-result` content parts, including multiple calls in one turn.
- Assert `streamText` receives a non-array `ToolSet` whose keys are the original function names.
- Assert a `web_search` definition preserves its `query` input schema and has no `execute` handler.

## 7. Wrong vs Correct

```typescript
// Wrong: OpenAI IR is not an AI SDK ModelMessage.
streamText({ model, messages: irMessages as never });

// Correct: adapt once at the SDK boundary.
const { messages } = separateSystem(request);
streamText({ model, messages });
```

```typescript
// Wrong: an OpenAI tools array is not an AI SDK ToolSet.
streamText({ model, tools: request.tools as never });

// Correct: adapt once at the SDK boundary and keep execution in the Agent loop.
streamText({ model, tools: toModelTools(request.tools) });
```
