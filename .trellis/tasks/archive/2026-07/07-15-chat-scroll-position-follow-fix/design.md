# Design — 修复聊天新消息中上部定位与流式跟随滚动失效

## 方案:移除虚拟滚动,接入 @shadcn/react/message-scroller

业界(含同源参考项目 DEEIX-Chat)用 shadcn 官方 `message-scroller` 原语,不虚拟滚动。原语一套覆盖了我们要的全部行为,因此**删除整个手写的 `useChatScrollController`**。

### 决策依据
- 实测确认:虚拟滚动(absolute 子项 + `getTotalSize` 异步测量)是两个效果的根源——pin `scrollBy` 被 clamp、`scrollHeight` 滞后、flex 居中失效。`14c64c2` commit 自己也预警了"流式跟随需手动验证 / 跳转受限(已知 TODO 未做)"。
- chat 消息几十~几百条,普通渲染无压力;虚拟滚动在此是净负(过度工程)。
- `@shadcn/react/message-scroller` 是公开 npm 包(peer 仅 `react>=19`,Nekosora ✓,与 next 版本无关)。

## API 映射(旧手写 → 新原语)

| 旧行为 | 新实现 |
|---|---|
| 流式跟随(`scrollTop=scrollHeight` 每帧) | `<Provider autoScroll>`(用户在 live edge 时跟随,wheel/touch/keyboard 释放) |
| prompt-pin 中上部(`scrollBy` 钉用户消息) | `<Item scrollAnchor={role==="user"}>` + `<Provider defaultScrollPosition="last-anchor">` + `<Content spacerClassName>` |
| isNearBottom(回到最新按钮显隐) | `useMessageScrollerScrollable().end` / `Button data-active` |
| `pinToMessageTop`(handleSend 手动调) | 删除——`scrollAnchor` 标在 user 消息即自动锚定 |
| hide-until-settled(进会话贴底淡入) | `<Provider defaultScrollPosition="end">` 打开即贴底(无虚拟滚动 measure,不再需要 opacity-0 遮测量) |
| activeMessageIndex(大纲高亮) | `useMessageScrollerVisibility().currentAnchorId` |
| `virtualizer.scrollToIndex`(大纲跳转) | `useMessageScroller().scrollToMessage(id)` |

## 改动清单

### 1. 依赖
- `+ @shadcn/react`(npm,装最新稳定版)
- `- @tanstack/react-virtual`(package.json + import)

### 2. `ChatMessageList.tsx` 重写
```tsx
<MessageScroller.Provider autoScroll defaultScrollPosition="end" scrollEdgeThreshold={24}>
  <MessageScroller.Root className="relative flex-1 min-h-0 ...">  {/* 现有外层 relative 容器 */}
    <MessageScroller.Viewport
      className="h-full overflow-y-auto px-6 pt-8 pb-2 md:pt-12 md:pb-3 [overflow-anchor:none]"
      preserveScrollOnPrepend
    >
      <MessageScroller.Content className="mx-auto w-full max-w-4xl flex flex-col">
        {messages.length === 0 ? <WelcomeBlock/> :
          messages.map((m, i) => (
            <MessageScroller.Item
              key={i} messageId={`msg-${i}`} scrollAnchor={m.role === "user"}
              className="py-4"
            >
              <ErrorBoundary><ChatMessageItem domId={`msg-${i}`} .../></ErrorBoundary>
            </MessageScroller.Item>
          ))
        }
      </MessageScroller.Content>
    </MessageScroller.Viewport>
    <MessageScroller.Button className="...暮色微澜样式...">{/* 回到最新 */}</MessageScroller.Button>
    <ChatOutline .../>  {/* 改用 visibility hook */}
  </MessageScroller.Root>
</MessageScroller.Provider>
```
- 普通 `messages.map`,无虚拟化;`Content` 用 `flex flex-col`(原语内部 spacer 处理锚定留白)。
- 样式沿用 Nekosora 现有 className + `clsx`(不引入 shadcn Button/cn)。

### 3. `ChatOutline.tsx` 改造
- `activeMessageIndex` ← `useMessageScrollerVisibility().currentAnchorId`(当前锚定轮)。
- `onJump(idx)` ← 父层 `useMessageScroller().scrollToMessage("msg-"+idx)`(替代 `scrollToIndex`)。

### 4. `ChatComposer.tsx`
- 移除 `useChatScrollController` 调用与其返回值(scrollRef/messagesEndRef/isNearBottom/ready/onScroll/scrollToBottom/pinToMessageTop)。
- `handleSend`/`handleSelectionAsk` 移除 `pinToMessageTop(...)`(scrollAnchor 自动)。
- `ready`(opacity-0 淡入)评估:无虚拟滚动后可移除 hide-until-settled;若要保留进会话淡入动效,用独立 `animate-in`(不再依赖 scroll 收敛)。

### 5. 删除 `useChatScrollController.ts`(整文件)。

## 设计适配(星枢天流 / 暮色微澜)
- Viewport/Content/Item 用现有 token(px-6 pt-8、max-w-4xl mx-auto、py-4)。
- 回到底部按钮复用现有样式(`bg-white dark:bg-space-ink border-morning-mist` 等),通过 `Button` 的 `render`/className 覆盖。

## 风险 / 回滚
- **next 15 兼容**:peer 仅要求 react>=19,理论兼容;需实测 HMR + 运行。
- **hide-until-settled 移除**:进会话可能短暂闪动,实测后决定是否补淡入。
- **ChatOutline 语义**:`currentAnchorId`(锚定轮)vs 旧 `activeMessageIndex`(首个可见),行为略变,需实测大纲高亮。
- **回滚**:`git checkout` 还原 + 卸 `@shadcn/react` + 复 `@tanstack/react-virtual`;无 DB/迁移/不可逆改动。
- 验收依赖浏览器实测(prd 四场景),无自动化测试。
