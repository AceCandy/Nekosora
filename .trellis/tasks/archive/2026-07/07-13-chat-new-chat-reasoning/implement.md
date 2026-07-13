# Implement — 新会话显示推理强度

## 改动文件

`src/app/chat/page.tsx`（仅 models 映射）

## 步骤

- [ ] import `ModelCapabilities` 类型：`import type { ModelCapabilities } from "@/db/types";`（参考 `src/app/chat/[id]/page.tsx:10`）。
- [ ] 在 models map（`:19-24`）里补字段：
  ```ts
  capabilities: (m.capabilities as ModelCapabilities | undefined) ?? undefined,
  ```
- verify: `pnpm typecheck`；手动：新会话页选可推理模型能看到推理强度 picker。

## 注意

- 不动 `ChatComposer` / `ChatToolbar` / `reasoning.ts`。
- 若 `getVisibleModels()` 返回项的 `capabilities` 字段名/结构与 `[id]/page.tsx` 一致（均为 `m.capabilities`），直接复用同一写法。
