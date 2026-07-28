# Model Message Boundary

## 1. Scope / Trigger

Apply this contract whenever `IRMessage[]` is passed to AI SDK `streamText` or `generateText`. The project IR follows OpenAI Chat Completions, while AI SDK 7 validates `ModelMessage[]` at runtime.

## 2. Signatures

```typescript
toModelMessages(messages: IRMessage[]): ModelMessage[]
separateSystem(request: IRRequest): { system: string | undefined; messages: ModelMessage[] }
```

Both generation paths must consume the `messages` returned by `separateSystem`.

## 3. Contracts

- Preserve string content and non-user messages.
- Convert user `{ type: "text", text }` parts to AI SDK text parts.
- Convert user `{ type: "image_url", image_url: { url } }` parts to `{ type: "file", data: new URL(url), mediaType: "image" }`.
- Keep OpenAI `image_url` in the shared IR and gateway API; conversion belongs only at the AI SDK boundary.
- A `data:` URL is passed as a `URL` so AI SDK extracts its concrete media type and base64 content. Remote URLs remain URL-backed file parts.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Valid remote or `data:` image URL | Convert to an AI SDK file part |
| Missing `image_url.url` | Throw `消息无效:图片缺少 URL` before the provider call |
| Malformed URL | `URL` construction fails before the provider call |
| Raw `image_url` reaches AI SDK | Runtime `ModelMessage[]` schema validation fails |

## 5. Good / Base / Bad Cases

- Good: mixed text plus remote and inline images converts without changing order.
- Base: a string user message remains unchanged.
- Bad: passing the OpenAI IR array directly to AI SDK fails only when an `image_url` part is present.

## 6. Tests Required

- Assert the converted messages pass `modelMessageSchema`.
- Run converted remote and `data:` URLs through `generateText` with `MockLanguageModelV4`.
- Assert the provider prompt keeps the remote URL and decodes the inline MIME/base64 data.
- Assert pure text remains unchanged and both `streamText` and `generateText` use `separateSystem` output.

## 7. Wrong vs Correct

```typescript
// Wrong: OpenAI IR is not an AI SDK ModelMessage.
streamText({ model, messages: irMessages as never });

// Correct: adapt once at the SDK boundary.
const { messages } = separateSystem(request);
streamText({ model, messages });
```
