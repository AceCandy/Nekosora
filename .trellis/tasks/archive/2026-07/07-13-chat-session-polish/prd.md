# Chat会话三项改进(工具栏顺序/新会话推理强度/丝滑进会话)

## Goal

一次性完成用户提出的 Chat 会话区三项前端改进，提升新会话首条消息的体验闭环：工具栏顺序更合理、新会话能设置推理强度、发消息后丝滑进入会话页。

## 交付物（三个独立可验证的 child）

| Child | 需求 | 主要文件 |
|---|---|---|
| `07-13-chat-toolbar-reorder` | ①工具栏顺序：模型 推理强度 联网 指令卡 知识库 模型参数 ｜ 输出模式 输出样式 | `ChatToolbar.tsx` |
| `07-13-chat-new-chat-reasoning` | ②新会话页能看到推理强度（当前仅历史会话可见） | `src/app/chat/page.tsx` |
| `07-13-chat-smooth-new-conversation` | ③新会话发消息后丝滑进入会话页，不再先跳首页 | `useChatRuntime.ts` + `ChatComposer.tsx` |

## 跨 Child 验收

- [ ] 三个 child 各自的 Acceptance Criteria 全部满足。
- [ ] 三项改动合并后，`pnpm lint && pnpm typecheck` 通过。
- [ ] 合并回归：新会话页工具栏顺序正确、推理强度可见、发首条消息丝滑无闪烁，且建会后切换推理档位能落库。

## 约束

- 三项均为前端改动，不动后端 API / DB schema / 路由结构。
- 遵循项目设计规范（DESIGN.md「星枢天流」）：工具栏仅做顺序重排，不新增视觉分隔条等 AI 模板痕迹元素。
- Surgical：只动各 child 列出的文件，不重构无关代码。

## Notes

- 需求间无强依赖，可任意顺序实现；建议 toolbar-reorder → new-chat-reasoning → smooth-new-conversation（由简到繁）。
- 需求 ② 与 ③ 有轻微交集：③ 会把 `ChatComposer` 的 `initialConvId` 改为可变 `activeConvId`，其中推理相关 action（`handleReasoningChange`）的 convId 取值会跟着变；② 只改 `page.tsx` 的 capabilities 透传，不碰这块，互不冲突。
