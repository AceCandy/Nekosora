# 新会话显示推理强度

## Goal

新会话页（`/chat`）选中可推理模型时，工具栏能看到推理强度 picker；当前只有历史会话页（`/chat/[id]`）能看到。

## Background / 根因

- `ChatComposer.tsx:191-192`：
  ```ts
  const currentCapabilities = models.find((item) => item.modelId === model)?.capabilities;
  const reasoning = resolveReasoningForModel(currentCapabilities, model, reasoningByModelId);
  ```
- `ChatToolbar.tsx:456` 的 `ReasoningPicker`：`if (!capabilities?.reasoning) return null;`，capabilities 为空就不渲染。
- 历史会话页 `src/app/chat/[id]/page.tsx:49` 映射 models 时带了 `capabilities`；新会话页 `src/app/chat/page.tsx:19-24` **漏了 `capabilities` 字段** → `currentCapabilities` 为 undefined → picker 不渲染、reasoning 默认 "off"。
- `getVisibleModels()` 已返回 capabilities 数据，只是 page 映射时没取。

## Requirements

- 新会话页 models 映射补上 `capabilities` 字段，与 `/chat/[id]/page.tsx:45-51` 对齐。
- 不改 `ChatComposer` / `ChatToolbar` / `reasoning.ts` 的逻辑（它们本身正确）。
- 推理档位初始化沿用 `resolveReasoningForModel`（默认取该模型最低可用档）。

## Acceptance Criteria

- [ ] 新会话页（`/chat`）选中支持推理的模型，工具栏出现推理强度 picker，默认档位正确。
- [ ] 选中不支持推理的模型，picker 隐藏（行为不变）。
- [ ] 历史会话页推理强度显示不受影响。
- [ ] 新会话发消息时，reasoning 档位随消息创建落库（`createConversation` 的 `reasoningByModelId`）。
- [ ] `pnpm lint && pnpm typecheck` 通过。

## Notes

- 一行级改动：`src/app/chat/page.tsx` models map 里加 `capabilities: (m.capabilities as ModelCapabilities | undefined) ?? undefined,`，并 import `ModelCapabilities` 类型（参考 `/chat/[id]/page.tsx:10,49`）。
