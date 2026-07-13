# Design — ChatHeader 下沉

## 改动点

### 1. `src/features/chat/components/ChatHeader.tsx`
- `conversationId: string` → `conversationId?: string`。
- 分享按钮 `disabled={isPending || !conversationId}`;`handleShare` 内 `if (!conversationId) return;`。

### 2. `src/features/chat/components/ChatComposer.tsx`
- `import ChatHeader from "@/features/chat/components/ChatHeader";`
- `ChatComposerProps` 加 `createShareAction: (id: string) => Promise<string>`。
- 加 `totalTokens` memo:
  ```ts
  const totalTokens = useMemo(
    () => runtime.messages.reduce((sum, m) => sum + (m.trace?.sentTokenEstimate ?? 0), 0),
    [runtime.messages],
  );
  ```
- `return` 主区顶部(`ChatMessageList` 之前)插:
  ```tsx
  <ChatHeader
    conversationId={activeConvId}
    messageCount={runtime.messages.length}
    totalTokens={totalTokens}
    createShareAction={createShareAction}
  />
  ```

### 3. `src/app/chat/page.tsx`
- `import { createShare } from "@/features/chat/actions/share";`
- 加 server action wrapper `handleCreateShare`(参考 `/chat/[id]/page.tsx:95-98`)。
- `<ChatComposer ... createShareAction={handleCreateShare} />`。

### 4. `src/app/chat/[id]/page.tsx`
- 移除独立 `<ChatHeader .../>` 渲染(`:103-108`)。
- `<ChatComposer ... createShareAction={handleCreateShare} />`(`handleCreateShare` 已有)。
- `ChatHeader` import 若不再用则移除。

## 数据流

- 新会话:`activeConvId=undefined` → header 占位,`messageCount=0`,`totalTokens=0`(不显示),分享禁用。
- 发消息:`runtime.messages` 增 → `messageCount` 实时增,`totalTokens` 随 trace 增。
- 建会:`activeConvId` 有值 → 分享启用。
- header 始终在(占位),内容异步增长,无「从无到有」跳变。

## 兼容性

- 历史页 header 数值从「SSR 算好传入」改为「runtime.messages 实时算」,值一致(SSR initialMessages 与 store 同源)。
- 分享功能不变(仍走 `createShare` server action)。
